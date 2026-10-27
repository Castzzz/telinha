// O FFmpeg codifica uma vez em Opus; esta ponte controla o relógio do áudio para todos.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/pion/webrtc/v4"
	"golang.org/x/net/websocket"
	"io"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

type command struct {
	Type      string                     `json:"type"`
	ID        string                     `json:"id"`
	SDP       *webrtc.SessionDescription `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
	Paused    bool                       `json:"paused"`
}

var outputMu sync.Mutex

func emit(value any) {
	outputMu.Lock()
	defer outputMu.Unlock()
	json.NewEncoder(os.Stdout).Encode(value)
}

func run() error {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	track, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
		SDPFmtpLine: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1",
	}, "musica", "teletela-musica")
	if err != nil {
		return err
	}
	var paused atomic.Bool
	go receiveAudio(listener, track, &paused)
	var config webrtc.Configuration
	if raw := os.Getenv("MUSIC_ICE_SERVERS"); raw != "" {
		if err = json.Unmarshal([]byte(raw), &config.ICEServers); err != nil {
			return err
		}
	}
	var peersMu sync.Mutex
	peers := map[string]*webrtc.PeerConnection{}
	defer func() {
		peersMu.Lock()
		defer peersMu.Unlock()
		for _, pc := range peers {
			pc.Close()
		}
	}()
	newPeer := func(id string) (*webrtc.PeerConnection, error) {
		pc, createErr := webrtc.NewPeerConnection(config)
		if createErr != nil {
			return nil, createErr
		}
		sender, addErr := pc.AddTrack(track)
		if addErr != nil {
			pc.Close()
			return nil, addErr
		}
		go func() {
			buffer := make([]byte, 1500)
			for {
				if _, _, err := sender.Read(buffer); err != nil {
					return
				}
			}
		}()
		peersMu.Lock()
		old := peers[id]
		peers[id] = pc
		peersMu.Unlock()
		if old != nil {
			old.Close()
		}
		return pc, nil
	}
	makeOffer := func(pc *webrtc.PeerConnection) (*webrtc.SessionDescription, error) {
		offer, offerErr := pc.CreateOffer(nil)
		if offerErr != nil {
			return nil, offerErr
		}
		gathered := webrtc.GatheringCompletePromise(pc)
		if offerErr = pc.SetLocalDescription(offer); offerErr != nil {
			return nil, offerErr
		}
		select {
		case <-gathered:
			return pc.LocalDescription(), nil
		case <-time.After(12 * time.Second):
			return nil, errors.New("a descoberta de rede da música demorou demais")
		}
	}
	ready := func() {
		emit(map[string]any{"type": "ready", "port": listener.Addr().(*net.TCPAddr).Port, "protocol": "opus-tcp"})
	}
	if url := os.Getenv("MUSIC_SFU_URL"); url != "" {
		ws, dialErr := websocket.Dial(url, "", "http://localhost")
		if dialErr != nil {
			return dialErr
		}
		defer ws.Close()
		pc, createErr := newPeer("sfu")
		if createErr != nil {
			return createErr
		}
		var once sync.Once
		pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
			if state == webrtc.PeerConnectionStateConnected {
				once.Do(ready)
			}
			if state == webrtc.PeerConnectionStateFailed {
				emit(map[string]any{"type": "error", "error": "a conexão do bot com o SFU caiu"})
			}
		})
		go func() {
			for {
				var message struct {
					Type    string `json:"type"`
					Message string `json:"message"`
					Data    struct {
						SDP *webrtc.SessionDescription `json:"sdp"`
					} `json:"data"`
				}
				if receiveErr := websocket.JSON.Receive(ws, &message); receiveErr != nil {
					emit(map[string]any{"type": "error", "error": "o SFU encerrou a conexão de música"})
					return
				}
				if message.Type == "error" {
					emit(map[string]any{"type": "error", "error": message.Message})
					return
				}
				if message.Type == "hello" {
					sdp, offerErr := makeOffer(pc)
					if offerErr == nil {
						offerErr = websocket.JSON.Send(ws, map[string]any{"to": "sfu", "data": map[string]any{"sdp": sdp}})
					}
					if offerErr != nil {
						emit(map[string]any{"type": "error", "error": offerErr.Error()})
						return
					}
				}
				if message.Data.SDP != nil {
					if answerErr := pc.SetRemoteDescription(*message.Data.SDP); answerErr != nil {
						emit(map[string]any{"type": "error", "error": answerErr.Error()})
						return
					}
				}
			}
		}()
	} else {
		ready()
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		var cmd command
		if json.Unmarshal(scanner.Bytes(), &cmd) != nil {
			continue
		}
		if cmd.Type == "pause" {
			paused.Store(cmd.Paused)
			continue
		}
		if cmd.Type == "subscribe" {
			pc, createErr := newPeer(cmd.ID)
			if createErr != nil {
				emit(map[string]any{"type": "error", "error": createErr.Error()})
				continue
			}
			// A coleta de ICE de um ouvinte não pode bloquear saída/cancelamento dos outros.
			go func(id string, peer *webrtc.PeerConnection) {
				sdp, offerErr := makeOffer(peer)
				if offerErr != nil {
					peer.Close()
					return
				}
				peersMu.Lock()
				current := peers[id] == peer
				peersMu.Unlock()
				if current {
					emit(map[string]any{"type": "offer", "id": id, "sdp": sdp})
				}
			}(cmd.ID, pc)
			continue
		}
		peersMu.Lock()
		pc := peers[cmd.ID]
		if cmd.Type == "unsubscribe" {
			delete(peers, cmd.ID)
		}
		peersMu.Unlock()
		if pc == nil {
			continue
		}
		switch cmd.Type {
		case "unsubscribe":
			pc.Close()
		case "answer":
			if cmd.SDP != nil && cmd.SDP.Type == webrtc.SDPTypeAnswer {
				pc.SetRemoteDescription(*cmd.SDP)
			}
		case "candidate":
			if cmd.Candidate != nil {
				pc.AddICECandidate(*cmd.Candidate)
			}
		}
	}
	return scanner.Err()
}

func main() {
	if err := run(); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, "Não foi possível publicar a música:", err)
		os.Exit(1)
	}
}
