import { useState } from "react";
import "./App.css";

import { CreateRoom, ConnectWSRoom } from "../wailsjs/go/main/App";

import MainScreen from "./MainScreen";
import RoomScreen from "./RoomScreen";

function App() {
  const [view, setView] = useState("main"); // "main" | "room"
  const [log, setLog] = useState("");
  const [roomId, setRoomId] = useState(null);
  const [roomState, setRoomState] = useState(null);

  const handleCreate = async () => {
    setLog("Создаём комнату...");

    try {
      const id = await CreateRoom();
      setRoomId(id);
      setLog("Комната создана: " + id);

      const state = await ConnectWSRoom(id);
      setRoomState(state);

      setView("room");
    } catch (err) {
      console.error(err);
      setLog("Ошибка: " + String(err));
    }
  };

  const handleJoin = async (inputId) => {
    const id = (inputId || "").trim();
    if (!id) {
      setLog("Введите ID комнаты");
      return;
    }

    setLog("Подключаемся к комнате " + id + "...");

    try {
      const state = await ConnectWSRoom(id);
      setRoomId(id);
      setRoomState(state);
      setView("room");
      setLog("Подключены к комнате: " + id);
    } catch (err) {
      console.error(err);
      setLog("Ошибка подключения: " + String(err));
    }
  };

  return (
    <>
      {view === "main" && (
        <MainScreen
          onCreate={handleCreate}
          onJoin={handleJoin}
          log={log}
        />
      )}

      {view === "room" && (
        <RoomScreen
          roomId={roomId}
          state={roomState}
        />
      )}
    </>
  );
}

export default App;




