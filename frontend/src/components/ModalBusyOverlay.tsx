type Props = {
  show: boolean;
  label?: string;
};

export function ModalBusyOverlay({ show, label = "Đang xử lý…" }: Props) {
  if (!show) return null;
  return (
    <div className="modal-busy-blocker" aria-live="polite" aria-busy="true">
      <span className="modal-busy-label">{label}</span>
    </div>
  );
}
