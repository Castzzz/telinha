// Telinha SFU: quem transmite manda o vídeo UMA vez pra este servidor, e ele repassa
// os pacotes pra todo mundo que está assistindo. Assim seu upload não depende de
// quantas pessoas estão vendo, e o atraso continua baixo (o servidor não re-codifica nada).
//
// Cada transmissão é uma "sala" do SFU (canal + quem transmite). O server.js (Node)
// cuida de canais, chat e voz, e entrega uma senha temporária (HMAC) pra quem pode
// transmitir ou assistir; sem SFU_SECRET (teste local) qualquer um entra.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
	"golang.org/x/net/websocket"
)

const sfuID = "sfu"

var (
	roomRe     = regexp.MustCompile(`^[\w-]{1,160}$`)
	api        *webrtc.API
	pcConfig   webrtc.Configuration
	iceForWeb  any // repassado pros navegadores no "hello"
	roomsMu    sync.Mutex
	rooms      = map[string]*Room{}
	httpPort   = env("PORT", "8081")
	sfuSecret  = os.Getenv("SFU_SECRET")
	mediaPort  = env("MEDIA_PORT", "50000")
	publicIP   = os.Getenv("PUBLIC_IP")
	defaultICE = `[{"urls":["stun:stun.l.google.com:19302","stun:stun.cloudflare.com:3478"]}]`
)

type Client struct {
	id   string
	role string
	out  chan []byte
	pc   *webrtc.PeerConnection // conexão entre este cliente e o servidor
}

type Room struct {
	mu        sync.Mutex
	host      *Client
	clients   map[string]*Client
	tracks    []*webrtc.TrackLocalStaticRTP
	expected  int // quantas faixas o host anunciou na oferta
	videoSSRC uint32
	lastPLI   time.Time
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func send(c *Client, msg map[string]any) {
	if c == nil {
		return
	}
	b, _ := json.Marshal(msg)
	select {
	case c.out <- b:
	default: // cliente travado; descarta
	}
}

func signalMsg(data map[string]any) map[string]any {
	return map[string]any{"type": "signal", "from": sfuID, "data": data}
}

func getRoom(name string) *Room {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	r := rooms[name]
	if r == nil {
		r = &Room{clients: map[string]*Client{}}
		rooms[name] = r
	}
	return r
}

// precisa estar com r.mu travado
func (r *Room) ready() bool {
	return r.host != nil && r.expected > 0 && len(r.tracks) == r.expected
}

// ---------- WebSocket ----------

// Senha = HMAC-SHA256(SFU_SECRET, "sala|papel|validade"), gerada pelo server.js
func authorized(name, role, exp, token string) bool {
	if sfuSecret == "" {
		return true
	}
	expires, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || time.Now().Unix() > expires {
		return false
	}
	mac := hmac.New(sha256.New, []byte(sfuSecret))
	mac.Write([]byte(name + "|" + role + "|" + exp))
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(token))
}

func handleSocket(ws *websocket.Conn) {
	q := ws.Request().URL.Query()
	name := q.Get("sala")
	role := "viewer"
	if q.Get("role") == "host" {
		role = "host"
	}
	if !roomRe.MatchString(name) {
		return
	}
	if !authorized(name, role, q.Get("exp"), q.Get("token")) {
		websocket.Message.Send(ws, `{"type":"error","message":"Sem permissão (senha do SFU inválida ou vencida)."}`)
		return
	}

	room := getRoom(name)
	c := &Client{id: newID(), role: role, out: make(chan []byte, 256)}

	room.mu.Lock()
	if role == "host" && room.host != nil {
		room.mu.Unlock()
		websocket.Message.Send(ws, `{"type":"error","message":"Já tem alguém transmitindo nessa sala. Use outro nome."}`)
		return
	}
	room.clients[c.id] = c
	send(c, map[string]any{"type": "hello", "id": c.id, "iceServers": iceForWeb, "mode": "sfu"})
	offerNow := false
	if role == "host" {
		room.host = c
		send(c, map[string]any{"type": "viewer-joined", "id": sfuID})
		send(c, map[string]any{"type": "count", "n": 0})
	} else if room.ready() {
		offerNow = true
	} else if room.host == nil {
		send(c, map[string]any{"type": "waiting"})
	}
	room.mu.Unlock()
	if offerNow {
		go room.offerViewer(c)
	}

	// um goroutine só escreve no socket; quem quiser mandar algo usa send()
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			select {
			case b := <-c.out:
				if websocket.Message.Send(ws, string(b)) != nil {
					ws.Close()
					return
				}
			case <-done:
				return
			}
		}
	}()

	ws.MaxPayloadBytes = 1 << 20
	for {
		var text string
		if err := websocket.Message.Receive(ws, &text); err != nil {
			room.leave(name, c)
			return
		}
		room.handleMessage(c, text)
	}
}

func (r *Room) leave(name string, c *Client) {
	var toClose []*webrtc.PeerConnection
	r.mu.Lock()
	delete(r.clients, c.id)
	if c.pc != nil {
		toClose = append(toClose, c.pc)
		c.pc = nil
	}
	wasHost := r.host == c
	if wasHost {
		r.host, r.tracks, r.expected = nil, nil, 0
		for _, v := range r.clients {
			if v.pc != nil {
				toClose = append(toClose, v.pc)
				v.pc = nil
			}
			send(v, map[string]any{"type": "host-left"})
		}
	}
	r.mu.Unlock()

	for _, pc := range toClose {
		pc.Close()
	}
	if !wasHost {
		r.sendCount()
	}

	roomsMu.Lock()
	r.mu.Lock()
	if len(r.clients) == 0 && rooms[name] == r {
		delete(rooms, name)
	}
	r.mu.Unlock()
	roomsMu.Unlock()
}

// ---------- sinalização ----------

type clientMsg struct {
	To   string `json:"to"`
	Data struct {
		SDP       *webrtc.SessionDescription `json:"sdp"`
		Candidate *webrtc.ICECandidateInit   `json:"candidate"`
	} `json:"data"`
}

func (r *Room) handleMessage(c *Client, text string) {
	var m clientMsg
	if json.Unmarshal([]byte(text), &m) != nil || m.To != sfuID {
		return // ping ou lixo
	}
	r.mu.Lock()
	isHost := r.host == c
	pc := c.pc
	r.mu.Unlock()

	var err error
	switch {
	case m.Data.SDP != nil && m.Data.SDP.Type == webrtc.SDPTypeOffer && isHost:
		err = r.acceptHost(c, *m.Data.SDP)
	case m.Data.SDP != nil && m.Data.SDP.Type == webrtc.SDPTypeAnswer && pc != nil:
		err = pc.SetRemoteDescription(*m.Data.SDP)
	case m.Data.Candidate != nil && pc != nil:
		err = pc.AddICECandidate(*m.Data.Candidate)
	}
	if err != nil {
		log.Printf("sinalização (%s): %v", c.role, err)
	}
}

// Responde a oferta de quem transmite. Mandamos a resposta já com todos os
// candidatos ICE (sem trickle) pra não ter corrida de ordem com o navegador.
func (r *Room) acceptHost(c *Client, offer webrtc.SessionDescription) error {
	pc, err := api.NewPeerConnection(pcConfig)
	if err != nil {
		return err
	}
	r.mu.Lock()
	if r.host != c {
		r.mu.Unlock()
		pc.Close()
		return errors.New("não é mais o host")
	}
	old := c.pc
	c.pc = pc
	r.tracks, r.expected = nil, 0
	r.mu.Unlock()
	if old != nil {
		old.Close()
	}

	pc.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) { r.forward(pc, remote) })
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		log.Printf("host: %s", s)
		if s == webrtc.PeerConnectionStateFailed {
			pc.Close()
		}
	})

	if err := pc.SetRemoteDescription(offer); err != nil {
		return err
	}
	r.mu.Lock()
	if c.pc == pc {
		r.expected = len(pc.GetTransceivers())
	}
	r.mu.Unlock()

	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return err
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		return err
	}
	<-gathered
	send(c, signalMsg(map[string]any{"sdp": pc.LocalDescription()}))
	return nil
}

// Repassa cada pacote RTP do host pra todo mundo que está com essa faixa.
func (r *Room) forward(hostPC *webrtc.PeerConnection, remote *webrtc.TrackRemote) {
	kind := remote.Kind().String()
	local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, kind, "telinha")
	if err != nil {
		log.Printf("faixa %s: %v", kind, err)
		return
	}

	r.mu.Lock()
	if r.host == nil || r.host.pc != hostPC {
		r.mu.Unlock()
		return
	}
	r.tracks = append(r.tracks, local)
	if remote.Kind() == webrtc.RTPCodecTypeVideo {
		r.videoSSRC = uint32(remote.SSRC())
	}
	var viewers []*Client
	if r.ready() {
		for _, v := range r.clients {
			if v.role == "viewer" {
				viewers = append(viewers, v)
			}
		}
	}
	r.mu.Unlock()
	log.Printf("recebendo %s (%s)", kind, remote.Codec().MimeType)
	for _, v := range viewers {
		go r.offerViewer(v)
	}

	buf := make([]byte, 1500)
	for {
		n, _, err := remote.Read(buf)
		if err != nil {
			return
		}
		if _, err := local.Write(buf[:n]); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			return
		}
	}
}

// Cria a conexão servidor -> quem assiste e manda a oferta.
func (r *Room) offerViewer(v *Client) {
	r.mu.Lock()
	if !r.ready() || r.clients[v.id] != v || v.pc != nil {
		r.mu.Unlock()
		return
	}
	tracks := slices.Clone(r.tracks)
	r.mu.Unlock()

	pc, err := api.NewPeerConnection(pcConfig)
	if err != nil {
		log.Printf("viewer: %v", err)
		return
	}
	for _, t := range tracks {
		sender, err := pc.AddTrack(t)
		if err != nil {
			log.Printf("viewer addTrack: %v", err)
			pc.Close()
			return
		}
		go r.readViewerRTCP(sender)
	}
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		switch s {
		case webrtc.PeerConnectionStateConnected:
			r.requestKeyframe(true)
		case webrtc.PeerConnectionStateFailed:
			pc.Close()
		}
		r.sendCount()
	})

	offer, err := pc.CreateOffer(nil)
	if err == nil {
		gathered := webrtc.GatheringCompletePromise(pc)
		if err = pc.SetLocalDescription(offer); err == nil {
			<-gathered
		}
	}
	if err != nil {
		log.Printf("viewer oferta: %v", err)
		pc.Close()
		return
	}

	r.mu.Lock()
	if r.clients[v.id] != v || v.pc != nil || !r.ready() {
		r.mu.Unlock()
		pc.Close()
		return
	}
	v.pc = pc
	r.mu.Unlock()
	send(v, signalMsg(map[string]any{"sdp": pc.LocalDescription()}))
}

// Quando alguém perde pacotes ou acabou de entrar, pede um keyframe pro host.
func (r *Room) readViewerRTCP(sender *webrtc.RTPSender) {
	for {
		pkts, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		for _, p := range pkts {
			switch p.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				r.requestKeyframe(false)
			}
		}
	}
}

func (r *Room) requestKeyframe(force bool) {
	r.mu.Lock()
	if r.host == nil || r.host.pc == nil || r.videoSSRC == 0 || (!force && time.Since(r.lastPLI) < 500*time.Millisecond) {
		r.mu.Unlock()
		return
	}
	r.lastPLI = time.Now()
	pc, ssrc := r.host.pc, r.videoSSRC
	r.mu.Unlock()
	pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: ssrc}})
}

func (r *Room) sendCount() {
	r.mu.Lock()
	n := 0
	for _, v := range r.clients {
		if v.role == "viewer" && v.pc != nil && v.pc.ConnectionState() == webrtc.PeerConnectionStateConnected {
			n++
		}
	}
	host := r.host
	r.mu.Unlock()
	send(host, map[string]any{"type": "count", "n": n})
}

// ---------- setup ----------

func setupWebRTC() {
	m := &webrtc.MediaEngine{}
	// Só VP8 + Opus: funciona em qualquer navegador (Chrome, Firefox, Safari).
	must(m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
			SDPFmtpLine: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1"},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio))
	videoFeedback := []webrtc.RTCPFeedback{{Type: "goog-remb"}, {Type: "transport-cc"}, {Type: "ccm", Parameter: "fir"}, {Type: "nack"}, {Type: "nack", Parameter: "pli"}}
	must(m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000, RTCPFeedback: videoFeedback},
		PayloadType:        96,
	}, webrtc.RTPCodecTypeVideo))

	ir := &interceptor.Registry{}
	must(webrtc.RegisterDefaultInterceptors(m, ir))

	port, err := strconv.Atoi(mediaPort)
	must(err)
	se := webrtc.SettingEngine{}
	udp, err := net.ListenUDP("udp", &net.UDPAddr{Port: port})
	must(err)
	// "universal" = também descobre o IP público via STUN quando o servidor está atrás de NAT
	se.SetICEUDPMux(ice.NewUniversalUDPMuxDefault(ice.UniversalUDPMuxParams{UDPConn: udp}))
	tcp, err := net.ListenTCP("tcp", &net.TCPAddr{Port: port})
	must(err)
	se.SetICETCPMux(webrtc.NewICETCPMux(nil, tcp, 64))
	se.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4, webrtc.NetworkTypeUDP6, webrtc.NetworkTypeTCP4, webrtc.NetworkTypeTCP6})
	if publicIP != "" {
		se.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}

	api = webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(ir), webrtc.WithSettingEngine(se))

	raw := env("ICE_SERVERS", defaultICE)
	var servers []webrtc.ICEServer
	must(json.Unmarshal([]byte(raw), &servers))
	must(json.Unmarshal([]byte(raw), &iceForWeb))
	if publicIP == "" {
		pcConfig.ICEServers = servers // servidor atrás de NAT: descobre o IP público via STUN
	}
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	setupWebRTC()
	mux := http.NewServeMux()
	// Quem pode entrar é decidido pela senha, não pela origem (o app vem de telinha://)
	mux.Handle("GET /ws", websocket.Server{Handler: handleSocket, Handshake: func(*websocket.Config, *http.Request) error { return nil }})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		roomsMu.Lock()
		n := len(rooms)
		roomsMu.Unlock()
		fmt.Fprintf(w, `{"status":"ok","rooms":%d}`, n)
	})

	fmt.Printf("📺 Telinha SFU rodando!\n\n")
	fmt.Printf("  Sinalização: ws://localhost:%s/ws\n", httpPort)
	if sfuSecret == "" {
		fmt.Printf("  ⚠️  SFU_SECRET vazio: qualquer um pode usar este SFU (só pra teste local)\n")
	}
	fmt.Printf("  Mídia:   porta %s (UDP e TCP) — libere no firewall\n", mediaPort)
	if publicIP != "" {
		fmt.Printf("  IP público anunciado: %s\n", publicIP)
	}
	fmt.Println()
	log.Fatal(http.ListenAndServe(":"+httpPort, mux))
}
