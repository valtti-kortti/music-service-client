// RoomScreen.jsx
import { useState, useEffect, useRef } from "react";
import { EventsOn } from "../wailsjs/runtime";
import {
  GetListVideo,
  AddVideoInQueue,
  PlayAndPause,
  Next,
  DeleteVideoInQueue,
  Seek,
} from "../wailsjs/go/main/App";

import "./RoomScreen.css";

// ---------- утилита форматирования времени ----------

function formatTime(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) return "0:00";

  const sec = Math.floor(totalSeconds);
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ---------- YouTube IFrame API helpers ----------

let ytApiPromise = null;

function loadYouTubeAPI() {
  if (typeof window === "undefined") return Promise.reject();

  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }

  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onload = () => {
      const check = () => {
        if (window.YT && window.YT.Player) {
          resolve(window.YT);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    };
    tag.onerror = reject;
    document.body.appendChild(tag);
  });

  return ytApiPromise;
}

function extractYoutubeId(url) {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/.*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

// ---------- YouTube player компонент ----------

function YouTubePlayer({ videoUrl, playing, position, onTimeUpdate }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const videoId = extractYoutubeId(videoUrl);

  const playingRef = useRef(playing);
  const positionRef = useRef(
    typeof position === "number" && position > 0 ? position : 0
  );

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    positionRef.current =
      typeof position === "number" && position > 0 ? position : 0;
  }, [position]);

  // создаём/меняем трек только при смене videoId
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;

    loadYouTubeAPI()
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const startPos = positionRef.current || 0;

        if (!playerRef.current) {
          playerRef.current = new window.YT.Player(containerRef.current, {
            videoId,
            height: "180",
            width: "320",
            playerVars: {
              controls: 0,
              modestbranding: 1,
              rel: 0,
              disablekb: 1, // отключаем управление с клавиатуры
            },
            events: {
              onReady: (event) => {
                try {
                  if (startPos > 0) {
                    event.target.seekTo(startPos, true);
                  }
                  if (playingRef.current) {
                    event.target.playVideo();
                  } else{
                    event.target.pauseVideo();
                  }
                } catch (e) {
                  console.error("onReady error:", e);
                }
              },
            },
          });
        } else {
          try {
            if (playingRef.current) {
              playerRef.current.loadVideoById(videoId, startPos);
            } else {
              playerRef.current.cueVideoById(videoId, startPos);
            }
          } catch (e) {
            console.error("load/cue error:", e);
          }
        }
      })
      .catch((e) => {
        console.error("YouTube API load error:", e);
      });

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // синхронизация позиции по серверному стейту
  useEffect(() => {
    const player = playerRef.current;
    if (!player || typeof position !== "number" || position < 0) return;

    try {
      const current =
        typeof player.getCurrentTime === "function"
          ? player.getCurrentTime()
          : 0;
      if (Math.abs(current - position) > 0.3) {
        player.seekTo(position, true);
      }
    } catch (e) {
      console.error("seek error:", e);
    }
  }, [position]);

  // play/pause без перезагрузки видео
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    try {
      if (playing) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch (e) {
      console.error("play/pause error:", e);
    }
  }, [playing]);

  // отдаём реальное время трека наверх, как корректировку
  useEffect(() => {
    if (!playing) return;
    const player = playerRef.current;
    if (!player || typeof player.getCurrentTime !== "function") return;

    const id = setInterval(() => {
      try {
        const t = player.getCurrentTime();
        onTimeUpdate && onTimeUpdate(t);
      } catch (e) {
        console.error("time update error:", e);
      }
    }, 1000); // раз в секунду для коррекции

    return () => clearInterval(id);
  }, [playing, onTimeUpdate]);

  return (
    <div
      style={{
        marginBottom: 12,
        borderRadius: 8,
        overflow: "hidden",
        width: "100%",
        height: 180,
        background: "#000",
        position: "relative",
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />
      {/* прозрачный оверлей, чтобы нельзя было кликать по видео */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          cursor: "default",
        }}
        onClick={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
      />
    </div>
  );
}

// ---------- Элемент результата поиска с умным скроллом названия ----------

function SearchResultItem({ video, onClick }) {
  const titleWrapperRef = useRef(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const wrapper = titleWrapperRef.current;
    if (!wrapper) return;

    const inner = wrapper.querySelector(".search-title-inner");
    if (!inner) return;

    const update = () => {
      // ширина текста > ширины контейнера?
      const canScroll = inner.scrollWidth > wrapper.clientWidth;
      setScrollable(canScroll);

      if (canScroll) {
        const diff = inner.scrollWidth - wrapper.clientWidth;
        // задаём переменную на wrapper (унаследуется внутрь)
        wrapper.style.setProperty("--scroll-distance", `-${diff}px`);
      } else {
        wrapper.style.removeProperty("--scroll-distance");
      }
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [video.title]);

  return (
    <li className="search-item" onClick={() => onClick(video)}>
      <div
        ref={titleWrapperRef}
        className={
          "search-title" + (scrollable ? " search-title--scrollable" : "")
        }
      >
        <span className="search-title-inner">{video.title}</span>
      </div>
      <div className="search-meta">{formatTime(video.duration)}</div>
    </li>
  );
}

// ---------- Основной экран комнаты ----------

export default function RoomScreen({ roomId, state: initialState }) {
  const [roomState, setRoomState] = useState(initialState || null);

  // позиция для прогресс-бара (локальный стейт)
  const [displayPosition, setDisplayPosition] = useState(
    initialState?.position || 0
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  const [copied, setCopied] = useState(false);

    const copyRoomId = () => {
    navigator.clipboard.writeText(roomId).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    });
    };

  useEffect(() => {
    const unbind = EventsOn("room_state", (newState) => {
      setRoomState(newState);
    });
    return () => {
      unbind();
    };
  }, []);

  const current = roomState?.current || null;
  const queue = roomState?.queue || [];
  const playing = roomState?.playing || false;
  const position = roomState?.position || 0;

  const isYoutube =
    current && current.url && /youtu\.be|youtube\.com/.test(current.url);

  const [seeking, setSeeking] = useState(false);      // сейчас тянем ползунок или нет
  const progressBarRef = useRef(null);                // ссылка на прогресс-бар

  const getPosFromClientX = (clientX) => {
    if (!current || !current.duration || !progressBarRef.current) return 0;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.min(Math.max(x / rect.width, 0), 1);

    return ratio * current.duration;
  };



  // локальный тикер — двигаем прогресс плавно
  useEffect(() => {
    if (!playing || !current || seeking) return;

    const id = setInterval(() => {
      setDisplayPosition((prev) => prev + 0.25);
    }, 250);

    return () => clearInterval(id);
  }, [playing, current?.url, seeking]);

  // корректируем по серверной позиции (редко, только если сильно уехало)
  useEffect(() => {
    if (!current) {
      setDisplayPosition(0);
      return;
    }

    if (seeking) return;

    setDisplayPosition((prev) => {
      const serverPos = position || 0;
      if (Math.abs(serverPos - prev) > 2.5) {
        return serverPos;
      }
      return prev;
    });
  }, [current?.url, position]);

  let progressPercent = 0;
  if (current && current.duration > 0) {
    progressPercent = Math.min(
      100,
      Math.max(0, (displayPosition / current.duration) * 100)
    );
  }

  // поиск видео
  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;

    setSearchError("");
    setSearchLoading(true);
    setResults([]);
    setActionMsg("");

    try {
      const list = await GetListVideo(q);
      setResults(list || []);
    } catch (e) {
      console.error(e);
      setSearchError(String(e));
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleAddToQueue = async (video) => {
    try {
      await AddVideoInQueue(video);
      // можно оставить actionMsg, если хочешь подсказку пользователю
      // setActionMsg(`Добавлено: ${video.title}`);
    } catch (e) {
      console.error(e);
      setActionMsg("Ошибка при добавлении в очередь: " + String(e));
    }
  };

  const handlePlayPause = async () => {
    try {
      await PlayAndPause();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteFromQueue = async (idx) => {
    try {
        await DeleteVideoInQueue(idx);
        // состояние комнаты обновится через EventsOn("room_state")
    } catch (e) {
        console.error(e);
        setActionMsg("Ошибка при удалении из очереди: " + String(e));
    }
    };

  const handleNext = async () => {
    try {
      await Next();
    } catch (e) {
      console.error(e);
    }
  };

  const handleProgressMouseDown = (e) => {
  if (!current || !current.duration) return;

  // сразу обновляем локальный прогресс по месту клика
  const newPos = getPosFromClientX(e.clientX);
  setSeeking(true);
  setDisplayPosition(newPos); // показываем предпросмотр

  // навешиваем слушатели на window, чтобы ловить движение и отпускание
  const handleMove = (moveEvent) => {
      const pos = getPosFromClientX(moveEvent.clientX);
      setDisplayPosition(pos);
    };

    const handleUp = async (upEvent) => {
      const finalPos = getPosFromClientX(upEvent.clientX);
      setSeeking(false);

      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);

      try {
        await Seek(finalPos); // отправляем на бэк
      } catch (err) {
        console.error("seek error:", err);
        setActionMsg("Ошибка перемотки: " + String(err));
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  if (!roomState) {
    return (
      <div className="room-page">
        <header className="room-header">
          <h2>Комната: {roomId}</h2>
          <span className="room-status">Загрузка...</span>
        </header>
      </div>
    );
  }

  return (
    <div className="room-page">
      <header className="room-header">
        <div className="room-header-left">
            <span
            className="room-roomid room-roomid--copyable"
            onClick={copyRoomId}
            >
            Комната {roomId}
            </span>
            {copied && <span className="copied-popup">Скопировано</span>}
        </div>

        <div className="room-header-center">
          <div className="room-now">
            {current ? current.title : "Ничего не играет"}
          </div>
        </div>

        <div className="room-header-right">
          <span className="room-status">{playing ? "Играет" : "Пауза"}</span>
        </div>
      </header>

      <div className="room-content">
        {/* Левая колонка — плеер + очередь */}
        <div className="room-left">
          {/* Плеер */}
          <div className="room-current">
            {current && isYoutube ? (
              <YouTubePlayer
                videoUrl={current.url}
                playing={playing}
                position={position}
                onTimeUpdate={(t) => {
                  setDisplayPosition((prev) =>
                    Math.abs(prev - t) > 1 ? t : prev
                  );
                }}
              />
            ) : (
              <div className="player-placeholder">
                {current
                  ? "Видео не поддерживается этим плеером"
                  : "Ничего не играет"}
              </div>
            )}

            {current ? (
              <>
                <div className="track-times">
                  <span>Позиция: {formatTime(displayPosition)}</span>
                  <span>Длительность: {formatTime(current.duration)}</span>
                </div>

                <div
                  className="progress-bar"
                  ref={progressBarRef}
                  onMouseDown={handleProgressMouseDown}
                >
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <div className="track-extra">
                  <span>
                    Обновлён:{" "}
                    {roomState?.updated_at
                      ? new Date(roomState.updated_at).toLocaleTimeString()
                      : "-"}
                  </span>
                </div>
              </>
            ) : (
              <div className="track-empty"></div>
            )}

            <div className="player-controls">
              <button onClick={handlePlayPause}>Play / Pause</button>
              <button onClick={handleNext}>Next</button>
            </div>
          </div>

          {/* Очередь под плеером */}
          <div className="room-queue-panel">
            <h3>Очередь</h3>

            {queue.length === 0 ? (
              <div className="queue-empty">Очередь пустая</div>
            ) : (
              <div className="queue-scroll">
                <ul className="queue-list">
                {queue.map((video, idx) => (
                    <li
                    key={idx}
                    className="queue-item"
                    onClick={() => handleDeleteFromQueue(idx)}
                    >
                    <div className="queue-title">{video.title}</div>

                    <div className="queue-meta">
                        {formatTime(video.duration)}
                    </div>
                    </li>
                ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Правая колонка — поиск */}
        <div className="room-search-wrapper">
          <div className="room-search">
            <input
              className="search-input"
              type="text"
              placeholder="Поиск видео..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          {searchError && (
            <div className="search-error">Ошибка поиска: {searchError}</div>
          )}

          <div className="search-results">
            {results.length > 0 && (
              <ul className="search-list">
                {results.map((v, idx) => (
                  <SearchResultItem
                    key={idx}
                    video={v}
                    onClick={handleAddToQueue}
                  />
                ))}
              </ul>
            )}

            {actionMsg && <div className="search-info">{actionMsg}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}










