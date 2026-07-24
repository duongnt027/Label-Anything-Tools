import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Box, imageUrl, LaImage } from "../api";
import AnnotationCanvas from "../components/AnnotationCanvas";

export default function GoldenEditor() {
  const { imageId } = useParams();
  const nav = useNavigate();
  const [img, setImg] = useState<LaImage | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const reloadBoxes = () => {
    if (!imageId) return;
    api<Box[]>(`/api/images/${imageId}/boxes`).then(setBoxes);
  };

  useEffect(() => {
    if (!imageId) return;
    api<LaImage>(`/api/images/${imageId}`).then(setImg);
    reloadBoxes();
  }, [imageId]);

  const addBox = async (points: string) => {
    if (!img) return;
    await api(`/api/images/${img.id}/boxes`, {
      method: "POST",
      body: JSON.stringify({ class: "golden", box_points: points }),
    });
    reloadBoxes();
  };

  if (!img) return <div>Đang tải...</div>;

  return (
    <div>
      <button type="button" onClick={() => nav(-1)}>
        ← Quay lại
      </button>
      <h3>Golden #{img.id}</h3>
      <div className="workspace" style={{ gridTemplateColumns: "200px 1fr" }}>
        <div className="panel">
          {boxes.map((b) => (
            <button key={b.id} type="button" onClick={() => setSelected(b.id)}>
              #{b.id} {b.class}
            </button>
          ))}
        </div>
        <div className="panel">
          <AnnotationCanvas
            imageUrl={imageUrl(img.id)}
            boxes={boxes}
            selectedId={selected}
            tool="box"
            onSelect={setSelected}
            onCreateBox={addBox}
          />
        </div>
      </div>
    </div>
  );
}
