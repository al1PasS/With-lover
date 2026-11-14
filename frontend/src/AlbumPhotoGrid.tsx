import { useState, type MouseEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { DotsSix, ImageSquare } from "@phosphor-icons/react";

type GridPhoto = { id: string; thumbnail: string };
type PhotoGridProps = {
  photos: GridPhoto[];
  coverId: string | null;
  sortable: boolean;
  open: (id: string, button: HTMLButtonElement) => void;
  move: (id: string, index: number) => void;
};

const findTarget: CollisionDetection = (input) =>
  input.pointerCoordinates ? pointerWithin(input) : closestCenter(input);

function PhotoTile({
  photo,
  index,
  isCover,
  sortable,
  open,
}: {
  photo: GridPhoto;
  index: number;
  isCover: boolean;
  sortable: boolean;
  open: PhotoGridProps["open"];
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: photo.id, disabled: !sortable });
  const label = `查看第 ${index + 1} 张照片${isCover ? "，封面" : ""}`;
  function click(event: MouseEvent<HTMLButtonElement>) {
    open(photo.id, event.currentTarget);
  }
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...(sortable ? listeners : {})}
      aria-pressed={sortable ? isDragging : undefined}
      aria-describedby={sortable ? attributes["aria-describedby"] : undefined}
      className={`album-photo-tile${isDragging ? " is-dragging" : ""}${isOver && sortable ? " is-drop-target" : ""}`}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
              transition,
            }
          : undefined
      }
      id={`activity-${photo.id}`}
      aria-label={label}
      onClick={click}
      onContextMenu={sortable ? (event) => event.preventDefault() : undefined}
    >
      <img src={photo.thumbnail} alt="" loading="lazy" draggable={false} />
      {isCover && (
        <span className="album-cover-tag">
          <ImageSquare aria-hidden="true" /> 封面
        </span>
      )}
      {sortable && (
        <DotsSix className="album-grip" aria-hidden="true" weight="bold" />
      )}
    </button>
  );
}

export default function AlbumPhotoGrid({
  photos,
  coverId,
  sortable,
  open,
  move,
}: PhotoGridProps) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 420, tolerance: 8 },
    }),
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );
  const active = photos.find((photo) => photo.id === dragged);
  const position = (id: string | number) =>
    photos.findIndex((photo) => photo.id === id) + 1;
  function finish() {
    setDragged(null);
    setHovered(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={findTarget}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "按空格拿起照片，用方向键移动，再按空格放下。按 Esc 取消。",
        },
        announcements: {
          onDragStart: ({ active }) => `已拿起第 ${position(active.id)} 张照片`,
          onDragOver: ({ over }) =>
            over ? `可移到第 ${position(over.id)} 位` : "已离开照片网格",
          onDragEnd: ({ active, over }) =>
            over && active.id !== over.id
              ? `已放到第 ${position(over.id)} 位`
              : "顺序未变",
          onDragCancel: () => "已取消排序",
        },
      }}
      onDragStart={({ active }) => setDragged(String(active.id))}
      onDragOver={({ over }) => setHovered(over ? String(over.id) : null)}
      onDragCancel={finish}
      onDragEnd={({ active, over }) => {
        finish();
        if (over && active.id !== over.id && sortable)
          move(String(active.id), position(over.id) - 1);
      }}
    >
      <SortableContext
        items={photos.map((photo) => photo.id)}
        strategy={rectSortingStrategy}
      >
        <section
          className={`album-photo-grid${dragged ? " is-sorting" : ""}`}
          aria-label="相册照片"
        >
          {photos.map((photo, index) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              index={index}
              isCover={coverId === photo.id}
              sortable={sortable}
              open={open}
            />
          ))}
        </section>
      </SortableContext>
      <DragOverlay dropAnimation={null} zIndex={12}>
        {active && (
          <div className="album-drag-preview" aria-hidden="true">
            <img src={active.thumbnail} alt="" draggable={false} />
            {hovered && <span>移至第 {position(hovered)} 位</span>}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
