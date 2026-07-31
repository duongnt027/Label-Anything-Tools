type Props = {
  index: number;
  name: string;
  status?: string;
  active: boolean;
  onClick: () => void;
};

function dotClass(status?: string) {
  if (status === "Accepted") return "accepted";
  if (status === "Rejected") return "rejected";
  return "unseen";
}

export function AnnoImageListItem({ index, name, status, active, onClick }: Props) {
  return (
    <button
      type="button"
      data-img-idx={index}
      className={`anno-image-row ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="anno-image-row-idx">{index + 1}</span>
      <span className="anno-image-row-name" title={name}>
        {name}
      </span>
      <span className={`dot ${dotClass(status)}`} aria-hidden />
    </button>
  );
}
