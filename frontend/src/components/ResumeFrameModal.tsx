type Props = {
  frameNumber: number;
  totalFrames: number;
  onContinue: () => void;
  onStartOver: () => void;
};

/** Ask whether to resume annotating/reviewing from the last viewed frame (DB footprint). */
export function ResumeFrameModal({ frameNumber, totalFrames, onContinue, onStartOver }: Props) {
  const pct = totalFrames > 0 ? Math.round((frameNumber / totalFrames) * 100) : 0;

  return (
    <div className="modal-backdrop resume-job-backdrop" role="dialog" aria-modal="true" aria-labelledby="resume-frame-title">
      <div className="resume-job-modal">
        <div className="resume-job-icon" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <h2 id="resume-frame-title" className="resume-job-title">
          Tiếp tục job?
        </h2>
        <p className="resume-job-lead">
          Bạn đang dừng ở frame trước. Muốn nhảy tới đó hay bắt đầu lại từ ảnh đầu?
        </p>
        <div className="resume-job-frame-card">
          <span className="resume-job-frame-label">Vị trí đã lưu</span>
          <span className="resume-job-frame-value">
            Ảnh <strong>{frameNumber}</strong>
            <span className="resume-job-frame-of"> / {totalFrames}</span>
          </span>
          <div className="resume-job-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="resume-job-actions">
          <button type="button" className="btn secondary resume-job-btn" onClick={onStartOver}>
            Từ đầu
          </button>
          <button type="button" className="btn primary resume-job-btn" onClick={onContinue}>
            Tiếp tục
          </button>
        </div>
      </div>
    </div>
  );
}
