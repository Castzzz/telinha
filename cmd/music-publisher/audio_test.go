package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/webrtc/v4/pkg/media"
)

func oggPage(segments []byte, payload []byte) []byte {
	header := make([]byte, 27)
	copy(header, "OggS")
	header[26] = byte(len(segments))
	return append(append(header, segments...), payload...)
}

func TestPacotesOggContinuadosEVariasFaixas(t *testing.T) {
	packet := bytes.Repeat([]byte{42}, 300)
	input := oggPage([]byte{8}, []byte("OpusHead"))
	input = append(input, oggPage([]byte{8}, []byte("OpusTags"))...)
	input = append(input, oggPage([]byte{255}, packet[:255])...)
	input = append(input, oggPage([]byte{45, 3}, append(packet[255:], 1, 2, 3))...)
	var got [][]byte
	err := readOpusPackets(bytes.NewReader(input), func(data []byte) error { got = append(got, bytes.Clone(data)); return nil })
	if !errors.Is(err, io.EOF) || len(got) != 2 || !bytes.Equal(got[0], packet) || !bytes.Equal(got[1], []byte{1, 2, 3}) {
		t.Fatalf("pacotes não foram preservados: %v, %v", got, err)
	}
	if err := readOpusPackets(bytes.NewReader(input[:len(input)-1]), func([]byte) error { return nil }); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("truncamento não foi detectado: %v", err)
	}
}

func TestRelogioNaoRecuperaAtrasoEmRajada(t *testing.T) {
	base := time.Now()
	for _, delay := range []time.Duration{8 * time.Millisecond, 19 * time.Millisecond, 200 * time.Millisecond, 2 * time.Second} {
		now := base.Add(delay)
		next, _ := audioDeadline(base, now)
		if next.Sub(now) < frameTime*3/4 {
			t.Fatalf("atraso %s gerou intervalo %s", delay, next.Sub(now))
		}
	}
}

type measuredOutput struct {
	times   []time.Time
	music   int
	silence int
	dropped int
	paused  *atomic.Bool
}

func (output *measuredOutput) WriteSample(sample media.Sample) error {
	output.times = append(output.times, time.Now())
	output.dropped += int(sample.PrevDroppedPackets)
	if bytes.Equal(sample.Data, []byte{0xf8, 0xff, 0xfe}) {
		output.silence++
	} else {
		output.music++
	}
	if output.music == 3 && output.silence == 0 {
		output.paused.Store(true)
		time.AfterFunc(120*time.Millisecond, func() { output.paused.Store(false) })
	}
	if output.music == 8 {
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}

func TestAudioMantemCadenciaEPausaNaoConsomeMusica(t *testing.T) {
	var input []byte
	for index := 0; index < 15; index++ {
		input = append(input, oggPage([]byte{2}, []byte{12, byte(index)})...)
	}
	var paused atomic.Bool
	output := &measuredOutput{paused: &paused}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := playOpus(ctx, bytes.NewReader(input), output, &paused)
	if !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
	if output.music != 15 || output.silence < 4 || output.dropped < 3 {
		t.Fatalf("música=%d silêncio=%d saltos=%d", output.music, output.silence, output.dropped)
	}
	for index := 1; index < len(output.times); index++ {
		if interval := output.times[index].Sub(output.times[index-1]); interval < 12*time.Millisecond {
			t.Fatalf("rajada de áudio após atraso: %s", interval)
		}
	}
}
