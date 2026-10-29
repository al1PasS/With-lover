import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowClockwise, Camera, ChatCircleDots, Check, FlowerLotus, Heart,
  Images, Microphone, NotePencil, PawPrint, Plus, Sparkle, Trash, X,
  Drop, SunHorizon, Trophy, Leaf, ArrowLeft, FolderOpen, FolderPlus,
  LockSimple,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import type { Memory } from "./types";
import { imageFileToData, useSharedState } from "./sharedState";

type Entry = { id: string; type: "message" | "story" | "chat" | "voice"; title: string; body: string; author: string; date: string; audio?: string };
type Wish = { id: string; text: string; done: boolean };
type Garden = { name: string; kind: "plant" | "pet"; level: number; water: number; sunlight: number; mood: number; growth: number; lastActions: Record<string,string> };
type Gacha = { shops: string[]; kinds: string[]; dishes: string[] };
type AlbumPhoto = { id: string; src: string; title: string; note: string; date: string };
type AlbumCollection = { id: string; title: string; description: string; category: "event" | "thing"; date: string; photos: AlbumPhoto[] };
type LegacyAlbumPhoto = AlbumPhoto & { category: "event" | "thing" };

const initialEntries: Entry[] = [
  { id: "hello", type: "message", title: "写给下一次打开这里的你", body: "今天也辛苦啦。看到这句话，就当收到一个隔空抱抱。", author: "晴", date: "2026-10-26" },
  { id: "story", type: "story", title: "月亮掉进了热牛奶", body: "从前有两颗不肯睡觉的星星，约好每天互道晚安以后，才一起关灯。", author: "杰", date: "2026-10-24" },
];
const initialWishes: Wish[] = [
  { id: "w1", text: "一起去看一次海边日出", done: false },
  { id: "w2", text: "学会做对方最喜欢的一道菜", done: false },
  { id: "w3", text: "拍一组四季合照", done: true },
];
const initialGacha: Gacha = {
  shops: ["家里简单做", "附近的家常菜馆", "常去的小店", "街边小馆", "外卖收藏夹"],
  kinds: ["热乎的", "下饭的", "清淡一点的", "带点辣的", "汤汤水水的", "很有烟火气的"],
  dishes: [
    "小米粥", "皮蛋瘦肉粥", "青菜肉丝面", "番茄鸡蛋面", "炸酱面", "小馄饨",
    "鱼香肉丝", "青椒肉丝", "番茄炒蛋", "红烧豆腐", "土豆烧牛肉", "可乐鸡翅",
    "卤鸭掌", "鸭掌煲", "清蒸鱼", "酸菜鱼", "红烧鱼块", "萝卜排骨汤",
    "扬州炒饭", "盖浇饭", "饺子", "麻辣烫", "砂锅米线", "煲仔饭", "烤肉拌饭",
  ],
};

function PageTitle({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return <div className="little-page-title"><div><span>OUR LITTLE WORLD</span><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function LoginGate({ user, onLogin }: { user: string | null; onLogin: () => void }) {
  if (user) return null;
  return <div className="private-gate"><Heart weight="duotone" size={28}/><div><strong>登录后，两个人一起维护</strong><p>这里的完整内容只留给你们。</p></div><button className="primary" onClick={onLogin}>进入空间</button></div>;
}

export function VisitorGate({ title, onLogin }: { title: string; onLogin: () => void }) {
  return <div className="visitor-gate"><div className="visitor-gate-mark"><LockSimple weight="duotone"/></div><div><h1>{title}</h1><p>这一页先轻轻合上了。这里收藏着只属于我们的内容，登录后就能继续翻看。</p><button className="primary" onClick={onLogin}>登录后再看</button><Link to="/">先回首页看看</Link></div></div>;
}

export function RecordsPage({ user, onLogin }: { user: string | null; onLogin: () => void }) {
  const { value: entries, save } = useSharedState("messages", user ? initialEntries : [], Boolean(user));
  const [type, setType] = useState<Entry["type"]>("message");
  const [recording, setRecording] = useState(false);
  const [audioDraft, setAudioDraft] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const labels = { message: "留言板", story: "睡前故事", chat: "日常对话", voice: "语音口袋" };
  if (!user) return <><PageTitle title="想说的话，都有地方安放。" copy="留言、睡前故事、日常碎片和声音，慢慢存成两个人的生活录音带。"/><VisitorGate title="记录盒里，留着彼此的话" onLogin={onLogin}/></>;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!user) return onLogin();
    const f = new FormData(e.currentTarget);
    const next: Entry = { id: crypto.randomUUID(), type, title: String(f.get("title")) || labels[type], body: String(f.get("body")), author: user, date: new Date().toISOString().slice(0, 10), audio: audioDraft || undefined };
    void save([next, ...entries]); e.currentTarget.reset(); setAudioDraft("");
  }
  async function toggleRecording() {
    if (!user) return onLogin();
    if (recorder.current?.state === "recording") { recorder.current.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      next.ondataavailable = (event) => chunks.push(event.data);
      next.onstop = () => {
        const reader = new FileReader();
        reader.onload = () => setAudioDraft(String(reader.result));
        reader.readAsDataURL(new Blob(chunks, { type: next.mimeType || "audio/webm" }));
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorder.current = next; next.start(); setRecording(true);
    } catch { alert("没有获得麦克风权限，请在浏览器设置中允许录音"); }
  }
  return <>
    <PageTitle title="想说的话，都有地方安放。" copy="留言、睡前故事、日常碎片和声音，慢慢存成两个人的生活录音带。" />
    <LoginGate user={user} onLogin={onLogin}/>
    <div className="record-tabs">{(Object.keys(labels) as Entry["type"][]).map((key) => <button key={key} className={type === key ? "active" : ""} onClick={() => setType(key)}>{key === "message" ? <NotePencil/> : key === "story" ? <Sparkle/> : key === "chat" ? <ChatCircleDots/> : <Microphone/>}{labels[key]}</button>)}</div>
    <div className="records-layout">
      <form className="paper-form" onSubmit={submit}>
        <h2>{labels[type]}</h2>
        <label>标题<input name="title" placeholder={type === "chat" ? "比如：今天最好笑的一句话" : "给这一页起个名字"}/></label>
        <label>{type === "voice" ? "语音备注" : "写下内容"}<textarea name="body" required rows={5} placeholder="把此刻留在这里…"/></label>
        {type === "voice" && <><button type="button" className={`voice-button ${recording ? "recording" : ""}`} onClick={toggleRecording}><Microphone weight={recording ? "fill" : "regular"}/>{recording ? "正在录音，点一下完成" : audioDraft ? "重新录一段" : "开始录一段声音"}</button>{audioDraft && <audio className="audio-preview" controls src={audioDraft}/>}</>}
        <button className="primary">放进记录盒</button>
      </form>
      <div className="entry-stream">{entries.filter((x) => x.type === type).map((item) => <article key={item.id}><div><span>{item.date}</span><span>{item.author} 写下</span></div><h2>{item.title}</h2><p>{item.body}</p>{item.audio && <audio controls src={item.audio}/>} {user && <button aria-label={`删除${item.title}`} onClick={() => void save(entries.filter((x) => x.id !== item.id))}><Trash/></button>}</article>)}{entries.filter((x) => x.type === type).length === 0 && <div className="soft-empty"><ChatCircleDots/><p>这一格还空着，等你写下第一句。</p></div>}</div>
    </div>
  </>;
}

export function WishesPage({ user, onLogin }: { user: string | null; onLogin: () => void }) {
  const { value: wishes, save } = useSharedState("wishes", user ? initialWishes : [], Boolean(user));
  function add(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (!user) return onLogin(); const f = new FormData(e.currentTarget); void save([...wishes, { id: crypto.randomUUID(), text: String(f.get("wish")), done: false }]); e.currentTarget.reset(); }
  const open = wishes.filter((w) => !w.done).length;
  if (!user) return <><PageTitle title="把以后，也写进今天。" copy="想去的地方、想做的小事、想一起成为的人，都不怕忘记。"/><VisitorGate title="愿望还在等我们慢慢实现" onLogin={onLogin}/></>;
  return <>
    <PageTitle title="把以后，也写进今天。" copy="想去的地方、想做的小事、想一起成为的人，都不怕忘记。" />
    <LoginGate user={user} onLogin={onLogin}/>
    <section className="wish-board"><div className="wish-summary"><FlowerLotus size={44} weight="duotone"/><strong>{open}</strong><span>个愿望，等我们一起实现</span></div><form onSubmit={add}><label htmlFor="new-wish">新的愿望</label><div><input id="new-wish" name="wish" required placeholder="比如：冬天一起去泡温泉"/><button className="primary"><Plus/>写下来</button></div></form><div className="wish-list">{wishes.map((wish) => <article className={wish.done ? "done" : ""} key={wish.id}><button className="wish-check" aria-label={wish.done ? "标记为未完成" : "标记为已完成"} onClick={() => void save(wishes.map((w) => w.id === wish.id ? { ...w, done: !w.done } : w))}>{wish.done && <Check weight="bold"/>}</button><span>{wish.text}</span><button className="wish-delete" aria-label={`删除${wish.text}`} onClick={() => void save(wishes.filter((w) => w.id !== wish.id))}><X/></button></article>)}</div></section>
  </>;
}

export function PlayPage({ user, onLogin }: { user: string | null; onLogin: () => void }) {
  const { value: garden, save: saveGarden } = useSharedState<Garden>("garden", { name: "小芽", kind: "plant", level: 1, water: 58, sunlight: 46, mood: 62, growth: 12, lastActions: {} }, Boolean(user));
  const { value: gacha } = useSharedState("gacha", initialGacha, Boolean(user));
  const [pick, setPick] = useState("按一下，让今天的晚饭自己决定");
  const [round, setRound] = useState({ mine: "待选择", theirs: "等待中", result: "选一个手势，开始这一轮" });
  const [score, setScore] = useState({ mine: 0, theirs: 0, draws: 0 });
  const [gardenNote, setGardenNote] = useState("今天也来看看小芽吧");
  if (!user) return <><PageTitle title="认真生活，也认真玩。" copy="一起养大一株小植物，晚饭交给扭蛋，偶尔来一局小小的胜负。"/><VisitorGate title="小游戏先替我们保守秘密" onLogin={onLogin}/></>;
  function draw() { const choose = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]; setPick(`${choose(gacha.kinds)}，${choose(gacha.shops)}，${choose(gacha.dishes)}`); }
  const safeGarden = { water: garden.water ?? 58, sunlight: garden.sunlight ?? 46, mood: garden.mood ?? 62, growth: garden.growth ?? 12, lastActions: garden.lastActions ?? {} };
  function care(action: "water" | "sun" | "talk") {
    if (!user) return onLogin();
    const today = new Date().toISOString().slice(0, 10);
    if (safeGarden.lastActions[action] === today) { setGardenNote(action === "water" ? "今天已经浇过水啦" : action === "sun" ? "今天已经晒过太阳啦" : "今天已经说过悄悄话啦"); return; }
    const next = {
      ...garden,
      water: Math.min(100, safeGarden.water + (action === "water" ? 22 : 3)),
      sunlight: Math.min(100, safeGarden.sunlight + (action === "sun" ? 22 : 2)),
      mood: Math.min(100, safeGarden.mood + (action === "talk" ? 24 : 4)),
      growth: safeGarden.growth + 5,
      level: Math.min(6, Math.floor((safeGarden.growth + 5) / 25) + 1),
      lastActions: { ...safeGarden.lastActions, [action]: today },
    };
    setGardenNote(action === "water" ? "叶子喝饱水，变得亮晶晶" : action === "sun" ? "暖暖的阳光落在新叶上" : "小芽听见了，心情变得很好");
    void saveGarden(next);
  }
  function playHand(mine: string) {
    const theirs = options[Math.floor(Math.random() * options.length)];
    const wins = (mine === "石头" && theirs === "剪刀") || (mine === "剪刀" && theirs === "布") || (mine === "布" && theirs === "石头");
    if (mine === theirs) { setRound({ mine, theirs, result: "平局，再来一轮刚刚好" }); setScore((s) => ({ ...s, draws: s.draws + 1 })); }
    else if (wins) { setRound({ mine, theirs, result: "你赢啦，这一手选得真准" }); setScore((s) => ({ ...s, mine: s.mine + 1 })); }
    else { setRound({ mine, theirs, result: "这一轮对方赢了，下一轮再追上" }); setScore((s) => ({ ...s, theirs: s.theirs + 1 })); }
  }
  const options = ["石头", "剪刀", "布"];
  return <>
    <PageTitle title="认真生活，也认真玩。" copy="一起养大一株小植物，晚饭交给扭蛋，偶尔来一局小小的胜负。" />
    <LoginGate user={user} onLogin={onLogin}/>
    <div className="play-grid">
      <section className="garden-card">
        <div className="garden-scene"><div className="garden-sun"/><span className="garden-sparkle one"/><span className="garden-sparkle two"/><div className={`plant level-${Math.min(garden.level, 4)}`}><span/><span/><span/><span/><i/><b/></div><div className="plant-shadow"/></div>
        <div className="garden-care"><span>我们共同照顾的</span><div className="garden-name"><div><h2>{garden.name}</h2><small>第 {garden.level} 级 · 成长值 {safeGarden.growth}</small></div><Leaf weight="duotone"/></div><p className="garden-note">{gardenNote}</p>
          <div className="garden-status"><span><Drop weight="fill"/><b>{safeGarden.water}</b><small>水分</small></span><span><SunHorizon weight="fill"/><b>{safeGarden.sunlight}</b><small>阳光</small></span><span><Heart weight="fill"/><b>{safeGarden.mood}</b><small>心情</small></span></div>
          <div className="garden-actions"><button onClick={() => care("water")}><Drop/>浇水</button><button onClick={() => care("sun")}><SunHorizon/>晒太阳</button><button onClick={() => care("talk")}><Heart/>说说话</button></div>
        </div>
      </section>
      <section className="gacha-card"><div className="gacha-machine"><div className="gacha-window"><span>吃</span><span>什</span><span>么</span></div><button aria-label="转动扭蛋机" onClick={draw}><ArrowClockwise weight="bold"/></button></div><div><h2>今晚吃什么</h2><p>{pick}</p><button className="primary" onClick={draw}>转一次扭蛋</button></div></section>
      <section className="mini-game"><div className="game-intro"><PawPrint size={34} weight="duotone"/><h2>三秒猜拳</h2><p>选一个手势，看看这一轮谁更有运气。</p><div className="score-board"><span>你 <b>{score.mine}</b></span><span>平局 <b>{score.draws}</b></span><span>对方 <b>{score.theirs}</b></span></div></div><div className="round-stage"><div className="hands"><strong><small>你出了</small>{round.mine}</strong><span>对</span><strong><small>对方出了</small>{round.theirs}</strong></div><div className="round-result"><Trophy weight="duotone"/>{round.result}</div></div><div className="hand-actions"><span>请选择</span>{options.map((x) => <button key={x} onClick={() => playHand(x)}>{x}</button>)}</div></section>
    </div>
  </>;
}

export function AlbumsPage({ user, onLogin, memories, albumId, publicAllowed }: { user: string | null; onLogin: () => void; memories: Memory[]; albumId?: string | null; publicAllowed: boolean }) {
  const navigate = useNavigate();
  const seeded = useMemo<AlbumCollection[]>(() => {
    const photos = memories.filter((memory) => memory.image).slice(0, 10).map((memory) => ({ id: `memory-${memory.id}`, src: memory.image, title: memory.title, note: memory.publicSummary || memory.body, date: memory.date }));
    const eventPhotos = photos.filter((_, index) => index % 2 === 0), thingPhotos = photos.filter((_, index) => index % 2 === 1);
    return [
      ...(eventPhotos.length ? [{ id: "our-trips", title: "一起去过的地方", description: "旅行、散步和认真看过的风景。", category: "event" as const, date: eventPhotos[0].date, photos: eventPhotos }] : []),
      ...(thingPhotos.length ? [{ id: "little-favorites", title: "喜欢的小事物", description: "花、食物和日常里可爱的发现。", category: "thing" as const, date: thingPhotos[0].date, photos: thingPhotos }] : []),
    ];
  }, [memories]);
  const { value: stored, save } = useSharedState<AlbumCollection[] | LegacyAlbumPhoto[]>("albums", user ? seeded : [], Boolean(user) || publicAllowed, !user && publicAllowed);
  const albums = useMemo<AlbumCollection[]>(() => {
    if (!stored.length) return [];
    if ("photos" in stored[0]) return stored as AlbumCollection[];
    const legacy = stored as LegacyAlbumPhoto[];
    return (["event", "thing"] as const).map((category) => ({
      id: `migrated-${category}`,
      title: category === "event" ? "旧事件照片" : "旧事物照片",
      description: "从旧版照片墙自动整理而来。",
      category,
      date: legacy.find((photo) => photo.category === category)?.date || new Date().toISOString().slice(0, 10),
      photos: legacy.filter((photo) => photo.category === category).map(({ category: _category, ...photo }) => photo),
    })).filter((album) => album.photos.length);
  }, [stored]);
  const [category, setCategory] = useState<"event" | "thing">("event");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AlbumPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const album = albums.find((item) => item.id === albumId);
  if (!user && !publicAllowed) return <><PageTitle title="我们的相册。" copy="每一本都是一个合集，照片墙只展示封面，点进去再慢慢翻看。"/><VisitorGate title="相册暂时只为彼此打开" onLogin={onLogin}/></>;
  async function persist(next: AlbumCollection[]) { await save(next); }
  async function createAlbum(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!user) return onLogin();
    const form = new FormData(e.currentTarget);
    const next: AlbumCollection = { id: crypto.randomUUID(), title: String(form.get("title")), description: String(form.get("description")), category: String(form.get("category")) as "event" | "thing", date: String(form.get("date")), photos: [] };
    await persist([next, ...albums]); setCreating(false); navigate(`/albums/${next.id}`);
  }
  async function addPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []); if (!album || !files.length) return;
    if (!user) return onLogin(); setUploading(true);
    try {
      const added = await Promise.all(files.slice(0, 20).map(async (file) => ({ id: crypto.randomUUID(), src: await imageFileToData(file, 1800), title: file.name.replace(/\.[^.]+$/, ""), note: "", date: new Date().toISOString().slice(0, 10) })));
      await persist(albums.map((item) => item.id === album.id ? { ...item, photos: [...item.photos, ...added] } : item));
    } catch (error) { alert((error as Error).message); }
    finally { setUploading(false); e.target.value = ""; }
  }
  function removeAlbum(target: AlbumCollection) {
    if (!window.confirm(`确定删除相册“${target.title}”及其中的照片吗？`)) return;
    void persist(albums.filter((item) => item.id !== target.id));
  }
  function removePhoto(photo: AlbumPhoto) {
    if (!album || !window.confirm(`确定移除“${photo.title}”吗？`)) return;
    void persist(albums.map((item) => item.id === album.id ? { ...item, photos: item.photos.filter((image) => image.id !== photo.id) } : item));
    setSelected(null);
  }
  if (albumId) {
    if (!album) return <div className="album-not-found"><FolderOpen/><h1>没有找到这本相册</h1><Link to="/albums">返回照片墙</Link></div>;
    return <>
      <header className="album-hero">
        <Link to="/albums" className="album-back"><ArrowLeft/>返回照片墙</Link>
        <div><span>{album.category === "event" ? "事件相册" : "事物相册"}</span><h1>{album.title}</h1><p>{album.description || "把属于这一册的照片放在一起。"}</p><small>{album.photos.length} 张照片 · {album.date.replaceAll("-", ".")}</small></div>
        {user && <label className="primary album-add"><Camera/>{uploading ? "正在整理照片" : "批量添加照片"}<input type="file" accept="image/*" multiple onChange={addPhotos} disabled={uploading}/></label>}
      </header>
      <section className="album-photo-grid">{album.photos.map((photo, index) => <button className={index % 7 === 0 ? "album-photo-featured" : ""} key={photo.id} onClick={() => setSelected(photo)}><img src={photo.src} alt={photo.title} loading="lazy"/><span>{photo.title}</span></button>)}{album.photos.length === 0 && <div className="soft-empty"><Images/><p>这本相册还是空的，从右上角添加第一批照片吧。</p></div>}</section>
      {user && <button className="album-delete" onClick={() => removeAlbum(album)}><Trash/>删除这本相册</button>}
      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="modal album-detail"><Dialog.Close className="close" aria-label="关闭照片"><X/></Dialog.Close>{selected && <><div className="album-detail-image"><img src={selected.src} alt={selected.title}/></div><div><span>{selected.date}</span><Dialog.Title>{selected.title}</Dialog.Title><Dialog.Description>{selected.note || `收录在《${album.title}》`}</Dialog.Description>{user && <button className="album-photo-delete" onClick={() => removePhoto(selected)}><Trash/>移出相册</button>}</div></>}</Dialog.Content></Dialog.Portal></Dialog.Root>
    </>;
  }
  const filtered = albums.filter((item) => item.category === category);
  return <>
    <PageTitle title="我们的相册。" copy="每一本都是一个合集，照片墙只展示封面，点进去再慢慢翻看。" action={<button className="primary" onClick={() => user ? setCreating(true) : onLogin()}><FolderPlus/>新建相册</button>}/>
    <LoginGate user={user} onLogin={onLogin}/>
    <div className="album-switch"><button className={category === "event" ? "active" : ""} onClick={() => setCategory("event")}>事件相册</button><button className={category === "thing" ? "active" : ""} onClick={() => setCategory("thing")}>事物相册</button></div>
    <section className="album-collection-wall">{filtered.map((item, index) => <Link to={`/albums/${encodeURIComponent(item.id)}`} key={item.id} className={index % 4 === 0 ? "album-collection-wide" : ""}><div>{item.photos[0] ? <img src={item.photos[0].src} alt="" loading="lazy"/> : <span className="album-empty-cover"><FolderOpen/></span>}<span className="album-count-badge">{item.photos.length} 张</span></div><section><span>{item.category === "event" ? "事件相册" : "事物相册"}</span><h2>{item.title}</h2><p>{item.description || "等待放进更多照片。"}</p></section></Link>)}{filtered.length === 0 && <div className="soft-empty"><FolderOpen/><p>这一类还没有相册，先新建一本吧。</p></div>}</section>
    <Dialog.Root open={creating} onOpenChange={setCreating}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="modal"><Dialog.Close className="close" aria-label="关闭"><X/></Dialog.Close><Dialog.Title>新建一本相册</Dialog.Title><Dialog.Description>先建立合集，再进入相册批量添加照片。</Dialog.Description><form onSubmit={createAlbum}><label>相册名称<input name="title" required maxLength={80} placeholder="例如：第一次去海边"/></label><label>相册分类<select name="category" defaultValue={category}><option value="event">事件相册</option><option value="thing">事物相册</option></select></label><label>日期<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)}/></label><label>相册说明<textarea name="description" rows={3} maxLength={300} placeholder="这本相册收集了什么？"/></label><button className="primary">创建并进入相册</button></form></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
