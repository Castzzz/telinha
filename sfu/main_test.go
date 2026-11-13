package main

import (
	"bytes"
	"errors"
	"io"
	"testing"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
)

type testPacketReader struct {
	packets [][]byte
	reads   int
}

func (r *testPacketReader) Read(buf []byte) (int, interceptor.Attributes, error) {
	if r.reads == len(r.packets) {
		return 0, nil, io.EOF
	}
	packet := r.packets[r.reads]
	r.reads++
	return copy(buf, packet), nil, nil
}

// Como o Pion: entrega ao espectador saudável e retorna o erro de outro espectador.
type testFanoutWriter struct {
	received [][]byte
	fail     func(int) error
}

func (w *testFanoutWriter) Write(packet []byte) (int, error) {
	w.received = append(w.received, bytes.Clone(packet))
	return len(packet), w.fail(len(w.received))
}

func TestForwardContinuaQuandoUmEspectadorFalha(t *testing.T) {
	viewerError := errors.New("transporte de um espectador falhou")
	for _, tc := range []struct {
		name string
		fail func(int) error
	}{
		{"erro temporário", func(n int) error {
			if n == 2 {
				return viewerError
			}
			return nil
		}},
		{"erro persistente", func(int) error { return viewerError }},
		{"conexão fechada", func(int) error { return io.ErrClosedPipe }},
		{"sem erro", func(int) error { return nil }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			packets := [][]byte{}
			for i, payload := range [][]byte{{1, 2, 3}, {4, 5}, {6, 7, 8, 9}, {10}} {
				packets = append(packets, marshalPacket(t, rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: uint16(i)}, Payload: payload}))
			}
			source := &testPacketReader{packets: packets}
			destination := &testFanoutWriter{fail: tc.fail}
			forwardPackets(source, destination, "video")
			if len(destination.received) != len(packets) {
				t.Fatalf("espectador saudável recebeu %d de %d pacotes", len(destination.received), len(packets))
			}
			for i, packet := range packets {
				if !bytes.Equal(destination.received[i], packet) {
					t.Fatalf("pacote %d foi alterado", i)
				}
			}
		})
	}
}

func TestForwardTerminaQuandoHostEncerra(t *testing.T) {
	destination := &testFanoutWriter{fail: func(int) error { return nil }}
	forwardPackets(&testPacketReader{}, destination, "audio")
	if len(destination.received) != 0 {
		t.Fatal("host encerrado não deve gerar envios")
	}
}

func marshalPacket(t *testing.T, packet rtp.Packet) []byte {
	t.Helper()
	raw, err := packet.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestForwardRemoveExtensoesDaConexaoDoHost(t *testing.T) {
	for _, kind := range []string{"video", "audio"} {
		t.Run(kind, func(t *testing.T) {
			var packets, expected [][]byte
			// Pacote atrasado e volta dos contadores precisam continuar recuperáveis por NACK.
			for i, sequence := range []uint16{65534, 65535, 0, 65535, 1} {
				packet := rtp.Packet{Header: rtp.Header{Version: 2, PayloadType: 96, SSRC: 1234,
					SequenceNumber: sequence, Timestamp: uint32(sequence) * 3000, Marker: i%2 == 0,
					CSRC: []uint32{42}}, Payload: []byte{0x10, byte(i), 3, 4}}
				expected = append(expected, marshalPacket(t, packet))
				// MID, TWCC e tempo de envio pertencem ao trecho host -> SFU.
				for id, data := range map[uint8][]byte{1: []byte("1"), 3: {0, byte(i)}, 4: {1, 2, 3}} {
					if err := packet.SetExtension(id, data); err != nil {
						t.Fatal(err)
					}
				}
				packets = append(packets, marshalPacket(t, packet))
			}
			destination := &testFanoutWriter{fail: func(int) error { return nil }}
			forwardPackets(&testPacketReader{packets: packets}, destination, kind)
			if len(destination.received) != len(expected) {
				t.Fatalf("recebeu %d pacotes", len(destination.received))
			}
			for i := range expected {
				if !bytes.Equal(destination.received[i], expected[i]) {
					t.Fatalf("pacote %d deve preservar mídia, sequência e timestamp, sem extensões do host", i)
				}
			}
		})
	}
}

func TestForwardIgnoraPacoteInvalidoSemEncerrarFaixa(t *testing.T) {
	valid := marshalPacket(t, rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: 7}, Payload: []byte{1, 2}})
	destination := &testFanoutWriter{fail: func(int) error { return nil }}
	forwardPackets(&testPacketReader{packets: [][]byte{{0x90}, valid}}, destination, "video")
	if len(destination.received) != 1 || !bytes.Equal(destination.received[0], valid) {
		t.Fatal("pacote inválido deve ser ignorado e o seguinte entregue")
	}
}
