import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowClockwise,
  ChatCircleDots,
  Check,
  FlowerLotus,
  Heart,
  Microphone,
  NotePencil,
  PawPrint,
  Plus,
  Sparkle,
  Trash,
  X,
  Drop,
  SunHorizon,
  Trophy,
  Leaf,
  LockSimple,
} from "@phosphor-icons/react";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSharedState } from "./sharedState";
import PostInteractions from "./PostInteractions";
import { postTime } from "./dates";
import { demoIdentity, usePostAuthor } from "./members";

const demo = import.meta.env.VITE_DEMO !== "false";

type Entry = {
  id: string;
  type: "message" | "story" | "chat" | "voice";
  title: string;
  body: string;
  author?: string;
  authorId?: number | string;
  publishedAt?: string;
  date: string;
  audio?: string;
};
type Wish = {
  id: string;
  text: string;
  done: boolean;
  authorId?: number | string;
};
type Garden = {
  name: string;
  kind: "plant" | "pet";
  level: number;
  water: number;
  sunlight: number;
  mood: number;
  growth: number;
  lastActions: Record<string, string>;
};
type Gacha = { shops: string[]; kinds: string[]; dishes: string[] };

const initialEntries: Entry[] = [
  {
    id: "hello",
    type: "message",
    title: "写给下一次打开这里的你",
    body: "今天也辛苦啦。看到这句话，就当收到一个隔空抱抱。",
    author: "晴",
    date: "2026-10-26",
  },
  {
    id: "story",
    type: "story",
    title: "月亮掉进了热牛奶",
    body: "从前有两颗不肯睡觉的星星，约好每天互道晚安以后，才一起关灯。",
    author: "杰",
    date: "2026-10-24",
  },
];
const initialWishes: Wish[] = [
  { id: "w1", text: "一起去看一次海边日出", done: false },
  { id: "w2", text: "学会做对方最喜欢的一道菜", done: false },
  { id: "w3", text: "拍一组四季合照", done: true },
];
const initialGacha: Gacha = {
  shops: [
    "家里简单做",
    "附近的家常菜馆",
    "常去的小店",
    "街边小馆",
    "外卖收藏夹",
  ],
  kinds: [
    "热乎的",
    "下饭的",
    "清淡一点的",
    "带点辣的",
    "汤汤水水的",
    "很有烟火气的",
  ],
  dishes: [
    "小米粥",
    "皮蛋瘦肉粥",
    "青菜肉丝面",
    "番茄鸡蛋面",
    "炸酱面",
    "小馄饨",
    "鱼香肉丝",
    "青椒肉丝",
    "番茄炒蛋",
    "红烧豆腐",
    "土豆烧牛肉",
    "可乐鸡翅",
    "卤鸭掌",
    "鸭掌煲",
    "清蒸鱼",
    "酸菜鱼",
    "红烧鱼块",
    "萝卜排骨汤",
    "扬州炒饭",
    "盖浇饭",
    "饺子",
    "麻辣烫",
    "砂锅米线",
    "煲仔饭",
    "烤肉拌饭",
  ],
};

export function PageTitle({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="little-page-title">
      <div>
        <span>OUR LITTLE WORLD</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  );
}

function LoginGate({
  user,
  onLogin,
}: {
  user: string | null;
  onLogin: () => void;
}) {
  if (user) return null;
  return (
    <div className="private-gate">
      <Heart weight="duotone" size={28} />
      <div>
        <strong>登录后，两个人一起维护</strong>
        <p>这里的完整内容只留给你们。</p>
      </div>
      <button className="primary" onClick={onLogin}>
        进入空间
      </button>
    </div>
  );
}

export function VisitorGate({
  title,
  onLogin,
}: {
  title: string;
  onLogin: () => void;
}) {
  return (
    <div className="visitor-gate">
      <div className="visitor-gate-mark">
        <LockSimple weight="duotone" />
      </div>
      <div>
        <h1>{title}</h1>
        <p>
          这一页先轻轻合上了。这里收藏着只属于我们的内容，登录后就能继续翻看。
        </p>
        <button className="primary" onClick={onLogin}>
          登录后再看
        </button>
        <Link to="/">先回首页看看</Link>
      </div>
    </div>
  );
}

export function RecordsPage({
  user,
  onLogin,
}: {
  user: string | null;
  onLogin: () => void;
}) {
  const {
    value: entries,
    save,
    loaded,
    error: loadError,
    reload,
  } = useSharedState(
    "messages",
    demo && user ? initialEntries : [],
    Boolean(user),
  );
  const [params] = useSearchParams();
  useEffect(() => {
    const entry = entries.find((x) => x.id === params.get("activity"));
    if (entry) setType(entry.type);
  }, [entries, params]);
  const [type, setType] = useState<Entry["type"]>("message");
  const [recording, setRecording] = useState(false);
  const [audioDraft, setAudioDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const author = usePostAuthor();
  const labels = {
    message: "留言板",
    story: "睡前故事",
    chat: "日常对话",
    voice: "语音口袋",
  };
  if (!user)
    return (
      <>
        <PageTitle
          title="想说的话，都有地方安放。"
          copy="留言、睡前故事、日常碎片和声音，慢慢存成两个人的生活录音带。"
        />
        <VisitorGate title="记录盒里，留着彼此的话" onLogin={onLogin} />
      </>
    );
  async function change(next: Entry[]) {
    setBusy(true);
    setError("");
    try {
      await save(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user || busy || !loaded || loadError || recording) return;
    const form = e.currentTarget,
      f = new FormData(form);
    const next: Entry = {
      id: crypto.randomUUID(),
      type,
      title: String(f.get("title")).trim() || labels[type],
      body: String(f.get("body")).trim(),
      date: new Date().toISOString().slice(0, 10),
      audio: audioDraft || undefined,
      ...(demo
        ? {
            authorId: demoIdentity(user),
            publishedAt: new Date().toISOString(),
          }
        : {}),
    };
    if (!next.body) {
      setError("请先写下内容");
      return;
    }
    if (await change([next, ...entries])) {
      form.reset();
      setAudioDraft("");
    }
  }
  async function toggleRecording() {
    if (!user) return onLogin();
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      next.ondataavailable = (event) => chunks.push(event.data);
      next.onstop = () => {
        const reader = new FileReader();
        reader.onload = () => setAudioDraft(String(reader.result));
        reader.readAsDataURL(
          new Blob(chunks, { type: next.mimeType || "audio/webm" }),
        );
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorder.current = next;
      next.start();
      setRecording(true);
    } catch {
      alert("没有获得麦克风权限，请在浏览器设置中允许录音");
    }
  }
  return (
    <>
      <PageTitle
        title="想说的话，都有地方安放。"
        copy="留言、睡前故事、日常碎片和声音，慢慢存成两个人的生活录音带。"
      />
      <LoginGate user={user} onLogin={onLogin} />
      <div className="record-tabs">
        {(Object.keys(labels) as Entry["type"][]).map((key) => (
          <button
            key={key}
            className={type === key ? "active" : ""}
            onClick={() => setType(key)}
          >
            {key === "message" ? (
              <NotePencil />
            ) : key === "story" ? (
              <Sparkle />
            ) : key === "chat" ? (
              <ChatCircleDots />
            ) : (
              <Microphone />
            )}
            {labels[key]}
          </button>
        ))}
      </div>
      <div className="records-layout">
        <form className="paper-form" onSubmit={submit}>
          <h2>{labels[type]}</h2>
          <label>
            标题
            <input
              name="title"
              placeholder={
                type === "chat"
                  ? "比如：今天最好笑的一句话"
                  : "给这一页起个名字"
              }
            />
          </label>
          <label>
            {type === "voice" ? "语音备注" : "写下内容"}
            <textarea
              name="body"
              required
              rows={5}
              placeholder="把此刻留在这里…"
            />
          </label>
          {type === "voice" && (
            <>
              <button
                type="button"
                className={`voice-button ${recording ? "recording" : ""}`}
                onClick={toggleRecording}
              >
                <Microphone weight={recording ? "fill" : "regular"} />
                {recording
                  ? "正在录音，点一下完成"
                  : audioDraft
                    ? "重新录一段"
                    : "开始录一段声音"}
              </button>
              {audioDraft && (
                <audio className="audio-preview" controls src={audioDraft} />
              )}
            </>
          )}
          <button
            className="primary"
            disabled={busy || !loaded || Boolean(loadError) || recording}
          >
            {busy ? "保存中…" : "放进记录盒"}
          </button>
          {(error || loadError) && (
            <p className="post-feedback" role="alert">
              {error || loadError}{" "}
              {loadError && (
                <button type="button" onClick={reload}>
                  重新加载
                </button>
              )}
            </p>
          )}
        </form>
        <div className="entry-stream">
          {entries
            .filter((x) => x.type === type)
            .map((item) => (
              <article key={item.id} id={`activity-${item.id}`}>
                <div className="entry-meta">
                  <span>{author(item.authorId, item.author)} 写下</span>
                  <time dateTime={item.publishedAt || item.date}>
                    {item.publishedAt ? postTime(item.publishedAt) : item.date}
                  </time>
                </div>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                {item.audio && <audio controls src={item.audio} />}
                <PostInteractions
                  key={`${item.id}:${params.get("activity") || ""}`}
                  module="messages"
                  id={item.id}
                  title={item.title}
                  user={user}
                  expanded={params.get("activity") === item.id}
                />
                <button
                  aria-label={`删除${item.title}`}
                  disabled={busy || !loaded || Boolean(loadError)}
                  onClick={() =>
                    void change(entries.filter((x) => x.id !== item.id))
                  }
                >
                  <Trash />
                </button>
              </article>
            ))}
          {!entries.some((x) => x.type === type) && (
            <div className="soft-empty">
              <ChatCircleDots />
              <p>
                {!loaded ? "正在打开记录盒…" : "这一格还空着，等你写下第一句。"}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function WishesPage({
  user,
  onLogin,
}: {
  user: string | null;
  onLogin: () => void;
}) {
  const {
    value: wishes,
    save,
    loaded,
    error: loadError,
    reload,
  } = useSharedState(
    "wishes",
    demo && user ? initialWishes : [],
    Boolean(user),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const author = usePostAuthor();
  const disabled = busy || !loaded || Boolean(loadError);
  async function change(next: Wish[]) {
    setBusy(true);
    setError("");
    try {
      await save(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user || disabled) return;
    const form = e.currentTarget,
      f = new FormData(form);
    const text = String(f.get("wish")).trim();
    if (
      text &&
      (await change([
        ...wishes,
        {
          id: crypto.randomUUID(),
          text,
          done: false,
          ...(demo ? { authorId: demoIdentity(user) } : {}),
        },
      ]))
    )
      form.reset();
  }
  const open = wishes.filter((w) => !w.done).length;
  if (!user)
    return (
      <>
        <PageTitle
          title="把以后，也写进今天。"
          copy="想去的地方、想做的小事、想一起成为的人，都不怕忘记。"
        />
        <VisitorGate title="愿望还在等我们慢慢实现" onLogin={onLogin} />
      </>
    );
  return (
    <>
      <PageTitle
        title="把以后，也写进今天。"
        copy="想去的地方、想做的小事、想一起成为的人，都不怕忘记。"
      />
      <section className="wish-board">
        <div className="wish-summary">
          <FlowerLotus size={44} weight="duotone" />
          <strong>{open}</strong>
          <span>个愿望，等我们一起实现</span>
        </div>
        <form onSubmit={add}>
          <label htmlFor="new-wish">新的愿望</label>
          <div>
            <input
              id="new-wish"
              name="wish"
              required
              maxLength={255}
              placeholder="比如：冬天一起去泡温泉"
            />
            <button className="primary" disabled={disabled}>
              <Plus />
              {busy ? "保存中…" : "写下来"}
            </button>
          </div>
        </form>
        {(error || loadError) && (
          <p className="post-feedback" role="alert">
            {error || loadError}{" "}
            {loadError && <button onClick={reload}>重新加载</button>}
          </p>
        )}
        <div className="wish-list">
          {wishes.map((wish) => (
            <article
              id={`activity-${wish.id}`}
              className={wish.done ? "done" : ""}
              key={wish.id}
            >
              <button
                className="wish-check"
                aria-label={wish.done ? "标记为未完成" : "标记为已完成"}
                disabled={disabled}
                onClick={() =>
                  void change(
                    wishes.map((w) =>
                      w.id === wish.id ? { ...w, done: !w.done } : w,
                    ),
                  )
                }
              >
                {wish.done && <Check weight="bold" />}
              </button>
              <div className="wish-copy">
                <span>{wish.text}</span>
                <small>提出人：{author(wish.authorId)}</small>
              </div>
              <button
                className="wish-delete"
                aria-label={`删除${wish.text}`}
                disabled={disabled}
                onClick={() =>
                  void change(wishes.filter((w) => w.id !== wish.id))
                }
              >
                <X />
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
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
