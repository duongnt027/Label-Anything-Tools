import { MouseEvent } from "react";
import { IconPause, IconPlay } from "./icons";
import type { ImageSlideshowSpeed } from "../hooks/useImageSlideshow";

type Props = {
  playing: boolean;
  speed: ImageSlideshowSpeed;
  onToggle: () => void;
  onCycleSpeed: () => void;
  disabled?: boolean;
};

function formatSpeed(s: ImageSlideshowSpeed) {
  return s === 1 ? "×1" : s === 1.5 ? "×1.5" : "×2";
}

export function AnnoSlideshowToggle({
  playing,
  speed,
  onToggle,
  onCycleSpeed,
  disabled,
}: Props) {
  const speedLabel = formatSpeed(speed);
  const title = playing
    ? `Dừng tự chuyển (${speedLabel}, Space). Chuột phải: đổi tốc độ`
    : `Tự chuyển ảnh (${speedLabel}, Space). Chuột phải: đổi tốc độ`;

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (disabled) return;
    onCycleSpeed();
  };

  return (
    <button
      type="button"
      className={`anno-slideshow-toggle ${playing ? "playing" : ""}`}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      disabled={disabled}
      title={title}
      aria-label={playing ? "Tạm dừng tự chuyển ảnh" : "Tự chuyển ảnh"}
      aria-pressed={playing}
    >
      {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      <span className="anno-slideshow-speed" aria-hidden>
        {speedLabel}
      </span>
    </button>
  );
}
