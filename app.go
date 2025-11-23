package main

import (
	"bytes"
	"context"
	"desktop/dto"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx    context.Context
	wsConn *websocket.Conn
	state  *dto.State

	playing bool
	current *dto.Video

	baseURL string
}

func NewApp(baseURL string) *App {
	return &App{
		playing: false,
		current: nil,
		baseURL: baseURL,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Создаём комнату через HTTP и возвращаем её ID
func (a *App) CreateRoom() (string, error) {
	resp, err := http.Post(a.baseURL+"/api/v1/rooms", "application/json", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var data dto.ResponseRoom
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}

	return data.ID.String(), nil
}

// Подключаемся к комнате по WebSocket
func (a *App) ConnectWSRoom(id string) (*dto.State, error) {
	if a.wsConn != nil {
		_ = a.wsConn.Close(websocket.StatusGoingAway, "reconnect")
		a.wsConn = nil
	}

	u1, err := url.Parse(a.baseURL)
	if err != nil {
		return nil, err
	}

	u := url.URL{
		Scheme: "ws",
		Host:   u1.Host,
		Path:   "/ws/room",
	}

	q := u.Query()
	q.Set("id", id)
	u.RawQuery = q.Encode()

	// подключаемся
	ctxDial, cancelDial := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDial()

	conn, _, err := websocket.Dial(ctxDial, u.String(), nil)
	if err != nil {
		return nil, err
	}

	a.wsConn = conn

	// читаем первый state
	ctxRead, cancelRead := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelRead()

	var st dto.State
	if err := wsjson.Read(ctxRead, a.wsConn, &st); err != nil {
		a.wsConn = nil
		return nil, err
	}

	// 🔹 сохраняем state внутри App
	a.state = &st
	a.current = st.Current
	a.playing = st.Playing

	a.ListenState()

	// и возвращаем его в React
	return &st, nil
}

func (a *App) GetListVideo(query string) ([]*dto.Video, error) {
	baseURL := a.baseURL + "/api/v1/videos"
	params := url.Values{}
	params.Add("name", query)

	fullURL := fmt.Sprintf("%s?%s", baseURL, params.Encode())

	resp, err := http.Get(fullURL)
	if err != nil {
		return nil, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bad status: %s", resp.Status)
	}

	var data []*dto.Video
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	return data, nil
}

func (a *App) AddVideoInQueue(data dto.Video) error {
	if a.state == nil {
		return fmt.Errorf("room state not received yet")
	}

	// правильный URL — добавляем по ID комнаты
	baseURL := a.baseURL + "/api/v1/rooms/queue"

	params := url.Values{}
	params.Add("id", a.state.ID.String())

	fullURL := fmt.Sprintf("%s?%s", baseURL, params.Encode())

	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	resp, err := http.Post(fullURL, "application/json; charset=utf-8", bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bad status %s: %s", resp.Status, string(body))
	}

	if a.current == nil {
		a.Next()
	}

	return nil
}

func (a *App) ListenState() {
	// если нет соединения — делать нечего
	if a.wsConn == nil {
		return
	}

	go func() {
		for {
			var st dto.State
			if err := wsjson.Read(a.ctx, a.wsConn, &st); err != nil {
				a.wsConn = nil
				return
			}

			a.state = &st
			a.current = st.Current
			a.playing = st.Playing
			runtime.EventsEmit(a.ctx, "room_state", st)
		}
	}()
}

func (a *App) PlayAndPause() error {
	if a.wsConn == nil {
		return fmt.Errorf("ws connection is nil")
	}

	var mes dto.Command

	if a.playing {
		mes.Type = "pause"
	} else {
		mes.Type = "play"

	}

	if err := wsjson.Write(a.ctx, a.wsConn, mes); err != nil {
		return err
	}

	return nil
}

func (a *App) Next() error {
	if a.wsConn == nil {
		return fmt.Errorf("ws connection is nil")
	}

	mes := dto.Command{Type: "next"}

	if err := wsjson.Write(a.ctx, a.wsConn, mes); err != nil {
		return err
	}

	return nil

}

func (a *App) DeleteVideoInQueue(idx int) error {
	if a.state == nil {
		return fmt.Errorf("room state not received yet")
	}

	baseURL := a.baseURL + "/api/v1/rooms/delete"

	params := url.Values{}
	params.Add("id", a.state.ID.String())
	params.Add("idx", strconv.Itoa(idx))

	fullURL := fmt.Sprintf("%s?%s", baseURL, params.Encode())

	client := &http.Client{}

	req, err := http.NewRequest(http.MethodDelete, fullURL, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bad status %s: %s", resp.Status, string(body))
	}

	return nil

}

func (a *App) Seek(pos float64) error {
	if a.state == nil {
		return fmt.Errorf("room state not received yet")
	}

	if a.state.Current == nil {
		return nil
	}

	baseURL := a.baseURL + "/api/v1/rooms/seek"

	params := url.Values{}
	params.Add("id", a.state.ID.String())
	params.Add("pos", strconv.FormatFloat(pos, 'f', 2, 64))

	fullURL := fmt.Sprintf("%s?%s", baseURL, params.Encode())

	resp, err := http.Post(fullURL, "", http.NoBody)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("bad status %s: %s", resp.Status, string(body))
	}

	return nil
}

func (a *App) ReturnBaseURL() string {
	return a.baseURL
}
