import { useState, useEffect } from "react";
import "./App.css";

import { ReturnBaseURL } from "../wailsjs/go/main/App";

export default function MainScreen({ onCreate, onJoin, log }) {
  const [roomIdInput, setRoomIdInput] = useState("");
  const [baseURL, setBaseURL] = useState("");

  useEffect(() => {
    ReturnBaseURL().then((url) => {
      setBaseURL(url);
    });
  }, []);

  const handleJoinClick = () => {
    onJoin(roomIdInput);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      onJoin(roomIdInput);
    }
  };

  return (
    <div className="main-screen">
      <div className="top-right-url">{baseURL}</div>

      <h1>Music Room</h1>

      <div className="buttons">
        <button onClick={onCreate}>Создать комнату</button>
      </div>

      <div className="join-block">
        <input
          className="join-input"
          type="text"
          placeholder="ID комнаты..."
          value={roomIdInput}
          onChange={(e) => setRoomIdInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={handleJoinClick}>Подключиться</button>
      </div>

      {log && <div className="log-message">{log}</div>}
    </div>
  );
}
