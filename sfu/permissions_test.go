package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"golang.org/x/net/websocket"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRevogacaoEncerraSocketEImpedeReutilizarToken(t *testing.T) {
	previous := sfuSecret
	sfuSecret = "segredo-local-do-teste"
	defer func() { sfuSecret = previous }()
	id := newID()
	exp := strconv.FormatInt(time.Now().Unix()+60, 10)
	mac := hmac.New(sha256.New, []byte(sfuSecret))
	mac.Write([]byte("canal-teste|viewer|" + exp + "|" + id))
	token := id + "." + hex.EncodeToString(mac.Sum(nil))
	if !authorized("canal-teste", "viewer", exp, token) {
		t.Fatal("token vinculado à entrada precisa ser válido")
	}
	if authorized("outro-canal", "viewer", exp, token) {
		t.Fatal("token não pode mudar de canal")
	}
	if authorized("canal-teste", "host", exp, token) {
		t.Fatal("espectador não pode transmitir")
	}
	server := httptest.NewServer(websocket.Server{Handler: handleSocket, Handshake: func(*websocket.Config, *http.Request) error { return nil }})
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "?sala=canal-teste&role=viewer&exp=" + exp + "&token=" + token
	ws, err := websocket.Dial(url, "", "http://localhost")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	ws.SetDeadline(time.Now().Add(3 * time.Second))
	var message string
	if err := websocket.Message.Receive(ws, &message); err != nil {
		t.Fatal(err)
	}
	unauthorized := httptest.NewRecorder()
	handleRevoke(unauthorized, httptest.NewRequest("POST", "/revoke", strings.NewReader(`{"id":"`+id+`"}`)))
	if unauthorized.Code != http.StatusForbidden {
		t.Fatal("revogação exige segredo do servidor")
	}
	request := httptest.NewRequest("POST", "/revoke", strings.NewReader(`{"id":"`+id+`"}`))
	request.Header.Set("Authorization", "Bearer "+sfuSecret)
	response := httptest.NewRecorder()
	handleRevoke(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("revogação falhou: %d", response.Code)
	}
	// Pode haver um aviso de espera no buffer; a conexão precisa terminar em seguida.
	for i := 0; i < 4; i++ {
		if err := websocket.Message.Receive(ws, &message); err != nil {
			break
		}
		if i == 3 {
			t.Fatal("socket revogado permaneceu aberto")
		}
	}
	if registerSession(id, &Client{}) {
		t.Fatal("token revogado não pode abrir outra sessão")
	}
	next := newID()
	c := &Client{}
	if !registerSession(next, c) {
		t.Fatal("nova entrada autorizada não deve ser bloqueada")
	}
	unregisterSession(next, c)
}
