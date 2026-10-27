package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4/pkg/media"
)

const frameTime = 20 * time.Millisecond

// Uma página Ogg pode conter vários pacotes, ou continuar um pacote da página anterior.
func readOpusPackets(input io.Reader, deliver func([]byte) error) error {
	var packet []byte
	for {
		header := make([]byte, 27)
		if _, err := io.ReadFull(input, header); err != nil {
			if errors.Is(err, io.EOF) && len(packet) != 0 {
				return io.ErrUnexpectedEOF
			}
			return err
		}
		if string(header[:4]) != "OggS" || header[4] != 0 {
			return errors.New("cabeçalho de áudio Ogg inválido")
		}
		segments := make([]byte, int(header[26]))
		if _, err := io.ReadFull(input, segments); err != nil {
			return err
		}
		for _, size := range segments {
			part := make([]byte, int(size))
			if _, err := io.ReadFull(input, part); err != nil {
				return err
			}
			packet = append(packet, part...)
			if len(packet) > 65536 {
				return errors.New("pacote de áudio grande demais")
			}
			if size == 255 {
				continue
			}
			if len(packet) > 0 && !bytes.HasPrefix(packet, []byte("OpusHead")) && !bytes.HasPrefix(packet, []byte("OpusTags")) {
				if err := deliver(packet); err != nil {
					return err
				}
			}
			packet = nil
		}
	}
}

// Atraso do processo vira silêncio/perda, nunca uma rajada para recuperar o relógio.
func audioDeadline(deadline, now time.Time) (time.Time, uint16) {
	late := now.Sub(deadline) / frameTime
	if late <= 0 && deadline.Add(frameTime).Sub(now) >= frameTime*3/4 {
		return deadline.Add(frameTime), 0
	}
	if late > 65535 {
		late = 65535
	}
	return now.Add(frameTime), uint16(late)
}

type sampleWriter interface{ WriteSample(media.Sample) error }

func playOpus(ctx context.Context, input io.Reader, output sampleWriter, paused *atomic.Bool) error {
	frames := make(chan []byte, 25)
	finished := make(chan error, 1)
	go func() {
		err := readOpusPackets(input, func(packet []byte) error {
			select {
			case frames <- packet:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		finished <- err
		close(frames)
	}()
	var first []byte
	select {
	case first = <-frames:
		if first == nil {
			return <-finished
		}
	case <-ctx.Done():
		return ctx.Err()
	}
	deadline := time.Now()
	epoch := deadline
	var slots uint64
	var played uint64
	var packets uint64
	var pending = first
	for {
		wait := time.Until(deadline)
		if wait > 0 {
			timer := time.NewTimer(wait)
			select {
			case <-timer.C:
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		now := time.Now()
		deadline, _ = audioDeadline(deadline, now)
		var skipped uint16
		wallSlots := uint64(now.Sub(epoch) / frameTime)
		if wallSlots > slots {
			gap := wallSlots - slots
			if gap > 65535 {
				gap = 65535
			}
			skipped = uint16(gap)
		}
		slots += uint64(skipped) + 1
		isPaused := paused.Load()
		if !isPaused && pending == nil {
			select {
			case frame, ok := <-frames:
				if !ok {
					return <-finished
				}
				pending = frame
			default:
			}
		}
		buffering := !isPaused && pending == nil
		// Silêncio Opus mantém o relógio RTP vivo durante pausa e falta de dados.
		payload := []byte{0xf8, 0xff, 0xfe}
		if !isPaused && pending != nil {
			payload = pending
			pending = nil
			played++
		}
		// Pion continua enviando aos demais mesmo se uma conexão falhar.
		output.WriteSample(media.Sample{Data: payload, Duration: frameTime, PrevDroppedPackets: skipped})
		packets++
		if packets == 1 || packets%25 == 0 {
			emit(map[string]any{"type": "progress", "position": float64(played) / 50, "buffering": buffering, "paused": isPaused})
		}
	}
}

func receiveAudio(listener net.Listener, output sampleWriter, paused *atomic.Bool) {
	connection, err := listener.Accept()
	if err != nil {
		return
	}
	defer connection.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err = playOpus(ctx, connection, output, paused)
	if err != nil && !errors.Is(err, io.EOF) {
		emit(map[string]any{"type": "error", "error": "falha ao ler o áudio: " + err.Error()})
	} else {
		emit(map[string]any{"type": "media-ended"})
	}
}
