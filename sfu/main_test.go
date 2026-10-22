package main

import (
	"bytes"
	"errors"
	"io"
	"testing"

	"github.com/pion/interceptor"
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
			packets := [][]byte{{1, 2, 3}, {4, 5}, {6, 7, 8, 9}, {10}}
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
