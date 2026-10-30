import { couple, occurrence, anniversaryLabel, anniversaryDays } from "./profile";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { NavLink, Link, useSearchParams, useLocation } from "react-router-dom";
import {
  Heart,
  House,
  Clock,
  MapPin,
  Images,
  Plus,
  ArrowRight,
  ArrowUpRight,
  Sun,
  Moon,
  Flower,
  Camera,
  CalendarBlank,
  LockSimple,
  X,
  MagnifyingGlass,
  SignOut,
  Gear,
  Trash,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  PencilSimple,
  FolderPlus,
  Notebook,
  ArrowLeft,
  Check,
  GlobeHemisphereEast,
  DotsThreeCircle,
  ChatCircleDots,
  GameController,
  ListChecks,
  UploadSimple,
} from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { demoMemories, demoAnniversaries } from "./demo";
import { dayDiff, nextLunarBirthday, today } from "./dates";
import { request, resetCsrf } from "./api/client";
import {
  defaultPrivacy,
  visitorCanView,
  type Memory,
  type Anniversary,
  type Place,
  type PrivacyPolicy,
} from "./types";
import { AlbumsPage, PlayPage, RecordsPage, VisitorGate, WishesPage } from "./LittleWorld";
import { imageFileToData } from "./sharedState";
const nav = [
  ["/", "首页", House],
  ["/timeline", "时光", Clock],
  ["/places", "足迹", MapPin],
  ["/albums", "相册", Images],
] as const;
const privacyModules = [
  ["home", "首页", "封面、相恋天数和首页内容"],
  ["timeline", "时光", "仅展示逐条标记为公开的摘要"],
  ["anniversaries", "纪念日", "展示纪念日名称和倒数日期"],
  ["albums", "相册", "展示相册和其中的照片"],
  ["places", "足迹", "展示管理员发布的城市长卷"],
] as const;
const demo = import.meta.env.VITE_DEMO !== "false";
const bundledCover = "/images/cover.webp";
function LoadingBlock({ className = "" }: { className?: string }) {
  return <span className={`loading-block ${className}`} aria-hidden="true" />;
}
function MemoryLoadingCards({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => (
    <article className="memory-card loading-card" key={index} aria-hidden="true">
      <LoadingBlock className="loading-photo" />
      <div className="memory-copy">
        <LoadingBlock className="loading-line short" />
        <LoadingBlock className="loading-line title" />
        <LoadingBlock className="loading-line" />
        <LoadingBlock className="loading-line medium" />
      </div>
    </article>
  ))}</>;
}
function AnniversaryLoadingRows() {
  return <div className="anniversary-loading" role="status" aria-label="纪念日加载中">
    {Array.from({ length: 3 }, (_, index) => <LoadingBlock className="loading-anniversary-row" key={index} />)}
  </div>;
}
function PlaceLoadingCards() {
  return <div className="place-loading" role="status" aria-label="足迹加载中">
    {Array.from({ length: 3 }, (_, index) => <LoadingBlock className="loading-place" key={index} />)}
  </div>;
}
function AnniversaryLoadingCards() {
  return <>{Array.from({ length: 3 }, (_, index) => (
    <article className="anniversary-paper loading-anniversary-card" key={index} aria-hidden="true">
      <LoadingBlock className="loading-line medium" />
      <LoadingBlock className="loading-line" />
      <LoadingBlock className="loading-number" />
    </article>
  ))}</>;
}
function decodeCover(raw: string | null | undefined) {
  if (!raw) return bundledCover;
  try {
    const value = JSON.parse(raw);
    return typeof value === "string" && value ? value : bundledCover;
  } catch {
    return bundledCover;
  }
}
function initialCover() {
  return demo ? decodeCover(localStorage.getItem("shiguang:cover")) : "";
}
function demoPrivacy() {
  try {
    const saved = localStorage.getItem("shiguang:privacy");
    return saved ? (JSON.parse(saved) as PrivacyPolicy) : defaultPrivacy;
  } catch {
    return defaultPrivacy;
  }
}
export default function App() {
  const [memories, setMemories] = useState<Memory[]>(demo && sessionStorage.getItem("shiguang:demo-user") ? demoMemories : []),
    [anniversaries, setAnniversaries] = useState<Anniversary[]>(
      demo && sessionStorage.getItem("shiguang:demo-user") ? demoAnniversaries : [],
    ),
    [user, setUser] = useState<string | null>(() => demo ? sessionStorage.getItem("shiguang:demo-user") : null),
    [userRole, setUserRole] = useState<string | null>(() => demo && sessionStorage.getItem("shiguang:demo-user") ? "ADMIN" : null),
    [loaded, setLoaded] = useState(demo),
    [memoriesLoading, setMemoriesLoading] = useState(false),
    [anniversariesLoading, setAnniversariesLoading] = useState(false),
    [placesLoading, setPlacesLoading] = useState(false),
    [placesLoaded, setPlacesLoaded] = useState(demo),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<
      "login" | "edit" | "anniversary" | "place" | null
    >(null),
    [selected, setSelected] = useState<Memory | null>(null),
    [editing, setEditing] = useState<Memory | null>(null),
    [editingAnniversary, setEditingAnniversary] =
      useState<Anniversary | null>(null),
    [anniversaryLunar, setAnniversaryLunar] = useState(false),
    [places, setPlaces] = useState<Place[]>([]),
    [editingPlace, setEditingPlace] = useState<Place | null>(null),
    [imageData, setImageData] = useState(""),
    [placeImage, setPlaceImage] = useState(""),
    [coverImage, setCoverImage] = useState(initialCover),
    [coverBusy, setCoverBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const [privacy, setPrivacy] = useState<PrivacyPolicy>(() => demo ? demoPrivacy() : defaultPrivacy);
  const [privacyDraft, setPrivacyDraft] = useState<PrivacyPolicy>(() => demo ? demoPrivacy() : defaultPrivacy);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const loadGeneration = useRef(0);
  const [dark, setDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const q = params.get("q") || "",
    tag = params.get("tag") || "烟火日常";
  const visible = memories.filter(
    (m) => !m.deleted && (user || (m.published && m.publicVisible)),
  );
  const filtered = visible.filter(
    (m) =>
      m.tag === tag &&
      `${m.title}${user ? m.body : m.publicSummary}`.includes(q),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    setSelected(null);
    setError("");
  }, [pathname]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function load() {
    const generation = ++loadGeneration.current;
    setLoaded(false);
    setCoverImage("");
    setError("");
    setMemoriesLoading(true);
    setAnniversariesLoading(true);
    setPlacesLoading(false);
    setPlacesLoaded(false);
    setPlaces([]);
    try {
      const [me, policy] = await Promise.all([
        request<{ name: string | null; role: string | null }>("/auth/me"),
        request<PrivacyPolicy>("/public/privacy"),
      ]);
      if (generation !== loadGeneration.current) return;
      const nextUser = me?.name || null;
      setUser(nextUser);
      setUserRole(me?.role || null);
      setPrivacy(policy);
      setPrivacyDraft(policy);
      setLoaded(true);
      const signedIn = Boolean(nextUser);
      const prefix = signedIn ? "" : "/public";
      if (signedIn || visitorCanView(policy, "home")) {
        setCoverImage(`/api/v1${prefix}/media/cover`);
      }

      void Promise.all([
        signedIn || visitorCanView(policy, "timeline") ? request<Memory[]>(prefix + "/memories") : Promise.resolve([]),
        signedIn ? request<Memory[]>("/trash") : Promise.resolve([]),
      ]).then(([rows, trash]) => {
        if (generation === loadGeneration.current) setMemories([...rows, ...trash]);
      }).catch((e) => {
        if (generation === loadGeneration.current) setError((e as Error).message);
      }).finally(() => {
        if (generation === loadGeneration.current) setMemoriesLoading(false);
      });

      void (signedIn || visitorCanView(policy, "anniversaries")
        ? request<Anniversary[]>(prefix + "/anniversaries")
        : Promise.resolve([]))
        .then((rows) => {
          if (generation === loadGeneration.current) setAnniversaries(rows);
        }).catch((e) => {
          if (generation === loadGeneration.current) setError((e as Error).message);
        }).finally(() => {
          if (generation === loadGeneration.current) setAnniversariesLoading(false);
        });
    } catch (e) {
      if (generation === loadGeneration.current) {
        setError((e as Error).message);
        setMemoriesLoading(false);
        setAnniversariesLoading(false);
      }
    } finally {
      if (generation === loadGeneration.current) setLoaded(true);
    }
  }
  useEffect(() => {
    if (!demo) void load();
  }, []);
  useEffect(() => {
    if (demo || !loaded || pathname !== "/places" || placesLoaded || placesLoading) return;
    if (!user && !visitorCanView(privacy, "places")) {
      setPlacesLoaded(true);
      return;
    }
    const generation = loadGeneration.current;
    setPlacesLoading(true);
    const prefix = user ? "" : "/public";
    void request<Place[]>(prefix + "/places")
      .then((rows) => {
        if (generation === loadGeneration.current) setPlaces(rows);
      })
      .catch((e) => {
        if (generation === loadGeneration.current) setError((e as Error).message);
      })
      .finally(() => {
        if (generation === loadGeneration.current) {
          setPlacesLoading(false);
          setPlacesLoaded(true);
        }
      });
  }, [loaded, pathname, placesLoaded, placesLoading, privacy, user]);
  async function savePrivacy() {
    setPrivacyBusy(true);
    try {
      const normalized = privacyDraft.mode === "PRIVATE"
        ? { ...privacyDraft, home: false, timeline: false, anniversaries: false, albums: false, places: false }
        : privacyDraft;
      const saved = demo
        ? normalized
        : await request<PrivacyPolicy>("/admin/privacy", {
            method: "PUT",
            body: JSON.stringify(normalized),
          });
      if (demo) localStorage.setItem("shiguang:privacy", JSON.stringify(saved));
      setPrivacy(saved);
      setPrivacyDraft(saved);
      setNotice(saved.mode === "PRIVATE" ? "访客入口已经轻轻合上" : "访客可见范围已经更新");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setPrivacyBusy(false);
    }
  }
  function openEdit(m: Memory | null = null) {
    setEditing(m);
    setImageData(m?.image || "");
    setFormError("");
    setModal(user ? "edit" : "login");
  }
  function chooseImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("请选择图片文件");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setFormError("照片请控制在 3MB 以内，方便快速发布");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageData(String(reader.result));
    reader.onerror = () => setFormError("照片读取失败，请换一张再试");
    reader.readAsDataURL(file);
  }
  async function choosePlaceImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return setFormError("请选择长卷图片");
    try {
      const bitmap = await createImageBitmap(file);
      const ratio = bitmap.width / bitmap.height;
      bitmap.close();
      if (ratio < 6 || ratio > 8) return setFormError("长卷比例需要在 6:1 至 8:1 之间，推荐使用 7:1");
      setPlaceImage(await imageFileToData(file, 3200));
      setFormError("");
    } catch (error) { setFormError((error as Error).message || "长卷读取失败，请换一张再试"); }
  }
  async function chooseCover(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setCoverBusy(true);
    try {
      const data = await imageFileToData(file, 2200);
      const raw = JSON.stringify(data);
      if (demo) localStorage.setItem("shiguang:cover", raw);
      else await request("/settings/cover", { method: "PUT", body: JSON.stringify({ value: raw }) });
      setCoverImage(data);
      setNotice("新的封面已经换好啦");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setCoverBusy(false);
      e.target.value = "";
    }
  }
  function openPlace(place: Place | null = null) { setEditingPlace(place); setPlaceImage(place?.panoramaImage || ""); setFormError(""); setModal(userRole === "ADMIN" ? "place" : "login"); }
  function openAnniversary(a: Anniversary | null = null) {
    setEditingAnniversary(a);
    setAnniversaryLunar(Boolean(a?.lunar));
    setFormError("");
    setModal(user ? "anniversary" : "login");
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setFormError("");
    try {
      if (demo) {
        const demoUser = String(f.get("username")) || couple.male;
        setUser(demoUser);
        setUserRole("ADMIN");
        setMemories(demoMemories);
        setAnniversaries(demoAnniversaries);
        sessionStorage.setItem("shiguang:demo-user", demoUser);
        setNotice("已进入示例编辑模式，内容保存在当前浏览器");
      } else {
        await request("/auth/login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(f)),
        });
        resetCsrf();
        await load();
      }
      setModal(null);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      if (!demo) await request("/auth/logout", { method: "POST" });
      resetCsrf();
      setUser(null);
      setUserRole(null);
      if (demo) sessionStorage.removeItem("shiguang:demo-user");
      setMemories([]);
      setAnniversaries([]);
      setPlaces([]);
      setSelected(null);
      if (!demo) await load();
      setNotice("已退出双人空间");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function saveMemory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    const f = new FormData(e.currentTarget);
    const m: Memory = {
      id: editing?.id || crypto.randomUUID(),
      title: String(f.get("title")),
      body: String(f.get("body")),
      date: String(f.get("date")),
      // Locations belong in the Footprints module. A daily post never makes
      // the author stop to fill in a city before publishing.
      city: editing?.city || "",
      tag: String(f.get("tag")),
      image: imageData,
      published: true,
      publicVisible: f.get("publicVisible") === "on",
      publicSummary: String(f.get("publicSummary")),
      version: editing?.version || 0,
    };
    try {
      if (m.publicVisible && !m.publicSummary.trim())
        throw new Error("公开前请填写独立的公开摘要");
      const saved = demo
        ? m
        : await request<Memory>(
            "/memories" + (editing ? "/" + editing.id : ""),
            { method: editing ? "PATCH" : "POST", body: JSON.stringify(m) },
          );
      setMemories((prev) => [saved, ...prev.filter((x) => x.id !== saved.id)]);
      setModal(null);
      setNotice(m.published ? "这一刻，已经好好收藏" : "草稿已保存");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: Memory, restore = false) {
    try {
      if (!demo)
        await request(
          restore ? "/trash/" + m.id + "/restore" : "/memories/" + m.id,
          { method: restore ? "POST" : "DELETE" },
        );
      setMemories((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, deleted: !restore } : x)),
      );
      setNotice(restore ? "回忆已恢复" : "已移入回收站，可在管理页恢复");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function saveAnniversary(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setFormError("");
    const lunarMonth = Number(f.get("lunarMonth"));
    const lunarDay = Number(f.get("lunarDay"));
    const lunar = anniversaryLunar
      ? { month: lunarMonth, day: lunarDay }
      : undefined;
    const item: Anniversary = {
      id: editingAnniversary?.id || crypto.randomUUID(),
      title: String(f.get("title")),
      date: lunar ? nextLunarBirthday(lunar.month, lunar.day) : String(f.get("date")),
      annual: Boolean(lunar) || f.get("annual") === "on",
      lunar,
      dateLabel: lunar ? `农历${lunarMonth}月${lunarDay}日` : undefined,
      sortOrder: editingAnniversary?.sortOrder,
    };
    try {
      // `dateLabel` and `sortOrder` are presentation state. Keep the API payload
      // limited to the editable anniversary fields.
      const { dateLabel: _dateLabel, sortOrder: _sortOrder, ...payload } = item;
      const saved = demo
        ? item
        : await request<Anniversary>(
            "/anniversaries" + (editingAnniversary ? "/" + item.id : ""),
            {
              method: editingAnniversary ? "PATCH" : "POST",
              body: JSON.stringify(payload),
            },
          );
      setAnniversaries((items) =>
        editingAnniversary
          ? items.map((a) => (a.id === saved.id ? saved : a))
          : [...items, saved],
      );
      setModal(null);
      setNotice(editingAnniversary ? "纪念日已更新" : "又多了一个值得记住的日子");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteAnniversary(a: Anniversary) {
    if (!window.confirm(`确定删除“${a.title}”吗？`)) return;
    try {
      if (!demo) await request(`/anniversaries/${a.id}`, { method: "DELETE" });
      setAnniversaries((items) => items.filter((item) => item.id !== a.id));
      setNotice("纪念日已删除");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function moveAnniversary(id: string, direction: -1 | 1) {
    const currentIndex = anniversaries.findIndex((a) => a.id === id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= anniversaries.length) return;
    const next = [...anniversaries];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    setAnniversaries(next);
    try {
      if (!demo)
        await request("/anniversaries/reorder", {
          method: "PATCH",
          body: JSON.stringify({ ids: next.map((a) => a.id) }),
        });
    } catch (e) {
      setAnniversaries(anniversaries);
      setNotice((e as Error).message);
    }
  }
  async function savePlace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!placeImage) return setFormError("请先上传生成好的城市长卷");
    setBusy(true);
    try {
      const input = { city: String(f.get("city")), panoramaImage: placeImage, visitDate: String(f.get("visitDate")) || null, description: String(f.get("description")) };
      const place = demo
        ? { id: editingPlace?.id || crypto.randomUUID(), ...input, visitDate: input.visitDate || undefined, sortOrder: editingPlace?.sortOrder ?? places.length }
        : await request<Place>(`/admin/places${editingPlace ? `/${editingPlace.id}` : ""}`, { method: editingPlace ? "PATCH" : "POST", body: JSON.stringify(input) });
      setPlaces((items) => editingPlace ? items.map((item) => item.id === place.id ? place : item) : [...items, place]);
      setModal(null); setEditingPlace(null); setNotice(editingPlace ? "足迹已经更新" : "新的城市长卷已经放进足迹");
    } catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  async function deletePlace(place: Place) {
    if (!window.confirm(`确定删除“${place.city}”这条足迹吗？`)) return;
    try { if (!demo) await request(`/admin/places/${place.id}`, { method: "DELETE" }); setPlaces((items) => items.filter((item) => item.id !== place.id)); setNotice("足迹已删除"); }
    catch (e) { setNotice((e as Error).message); }
  }
  async function movePlace(id: string, direction: -1 | 1) {
    const index = places.findIndex((place) => place.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= places.length) return;
    const next = [...places]; [next[index], next[target]] = [next[target], next[index]]; setPlaces(next);
    try { if (!demo) await request("/admin/places/reorder", { method: "PATCH", body: JSON.stringify({ ids: next.map((place) => place.id) }) }); }
    catch (e) { setPlaces(places); setNotice((e as Error).message); }
  }
  const sectionHead = (title: string, subtitle: string, action?: ReactNode) => (
    <div className="page-heading">
      <div>
        <span className="kicker">OUR LITTLE WORLD</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
  function card(m: Memory, i: number) {
    return (
      <article
        className="memory-card"
        key={m.id}
        style={{ animationDelay: `${i * 60}ms` }}
      >
        <button className="photo-button" onClick={() => setSelected(m)}>
          {m.image ? (
            <img src={m.image} alt={m.title} loading="lazy" />
          ) : (
            <div className="no-photo">
              <Notebook size={44} />
              <span>文字也能留住一刻</span>
            </div>
          )}
        </button>
        <div className="memory-copy">
          <div className="meta">
            <span>{m.date.replaceAll("-", ".")}</span>
          </div>
          <button className="text-title" onClick={() => setSelected(m)}>
            {m.title}
          </button>
          <p>{m.publicSummary || m.body}</p>
          <div className="card-bottom">
            <span className="tag">{m.tag}</span>
            <Heart size={18} />
          </div>
        </div>
      </article>
    );
  }
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-icon">
            <Heart weight="fill" />
          </span>
          <strong>
            拾光<span>OUR DAYS</span>
          </strong>
        </Link>
        <nav aria-label="主导航">
          {nav.map(([url, label, Icon]) => (
            <NavLink key={url} to={url}>
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
          <div className="more-menu">
            <button className="more-menu-trigger" type="button" aria-haspopup="menu"><DotsThreeCircle size={19} />更多</button>
            <div role="menu" aria-label="更多功能">
              <Link role="menuitem" to="/records"><ChatCircleDots />记录盒<span>留言、故事和声音</span></Link>
              <Link role="menuitem" to="/play"><GameController />一起玩<span>扭蛋与共同养成</span></Link>
              <Link role="menuitem" to="/wishes"><ListChecks />愿望单<span>以后一起完成</span></Link>
            </div>
          </div>
        </nav>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => setDark(!dark)}
            aria-label={dark ? "切换浅色" : "切换深色"}
          >
            {dark ? <Sun /> : <Moon />}
          </button>
          {user ? (
            <>
              <Link className="profile" to="/admin" aria-label="管理我们的空间">
                {user.slice(0, 1)}
              </Link>
              <button
                className="icon-button"
                aria-label="退出登录"
                onClick={logout}
              >
                <SignOut />
              </button>
            </>
          ) : (
            <button
              className="login-button"
              onClick={() => {
                setFormError("");
                setModal("login");
              }}
            >
              <LockSimple size={15} />
              进入我们的小世界
            </button>
          )}
        </div>
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={load}>重新加载</button>
          </div>
        )}
        {!loaded ? (
          <div className="skeleton" aria-label="正在加载回忆" />
        ) : (
          <>
            {pathname === "/" && (user || visitorCanView(privacy, "home") ? (
              <>
                <section className="hero">
                  <div className="hero-copy">
                    <div className="couple-label">
                      <span className="avatar">晴</span>
                      <span className="avatar second">杰</span>
                      <span>
                        {couple.female} <Heart size={13} weight="fill" />{" "}
                        {couple.male}的小小宇宙
                      </span>
                    </div>
                    <h1>
                      把我们，
                      <br />
                      写进<span className="pink-word">日常</span>。
                    </h1>
                    <p className="hero-description">
                      有些日子闪闪发光，有些日子平平常常。
                      <br />
                      只要身边是你，就都值得收藏。
                    </p>
                    <div className="day-counter">
                      <span>我们已经一起走过</span>
                      <div>
                        <strong>
                          {dayDiff(couple.togetherSince).toLocaleString()}
                        </strong>
                        <span>天</span>
                        <Heart weight="duotone" size={25} />
                      </div>
                      <small>从 2026 年 9 月 12 日，到每一个明天</small>
                    </div>
                    <div className="hero-buttons">
                      <button className="primary" onClick={() => openEdit()}>
                        <Plus size={18} />
                        记录此刻
                      </button>
                      <Link className="subtle-link" to="/timeline">
                        翻翻我们的故事
                        <ArrowRight size={17} />
                      </Link>
                    </div>
                  </div>
                  <div className="hero-visual">
                    <div className="hero-photo">
                      <div className="tape" />
                      {coverImage ? (
                        <img
                          src={coverImage}
                          alt="我们的封面照片"
                          fetchPriority="high"
                          decoding="async"
                        />
                      ) : (
                        <div className="hero-photo-placeholder" role="status" aria-label="封面加载中" />
                      )}
                      {user && <label className="cover-change"><UploadSimple />{coverBusy ? "处理中" : "更换封面"}<input type="file" accept="image/*" onChange={chooseCover} disabled={coverBusy}/></label>}
                      <div className="photo-caption">
                        <span>和你一起，哪里都是好天气。</span>
                        <Heart size={22} />
                      </div>
                    </div>
                    <div className="date-sticker">
                      <span>OUR DAYS</span>
                      <strong>每一天</strong>
                      <small>都想和你一起</small>
                    </div>
                    <Flower className="flower" size={58} weight="duotone" />
                    <span className="hand-note">little moments, big love.</span>
                  </div>
                </section>
                <div className="intro-divider">
                  <Heart size={16} />
                  <span>两个人的小事，就是我们的全世界</span>
                  <span className="divider-line" />
                </div>
                <section className="world-menu" aria-label="我们的小功能">
                  <Link to="/records" className="world-menu-main"><ChatCircleDots weight="duotone"/><span><strong>记录盒</strong><small>留言、睡前故事、对话与语音</small></span><ArrowRight/></Link>
                  <Link to="/play"><GameController weight="duotone"/><span><strong>一起玩</strong><small>养一株小芽，决定今晚吃什么</small></span></Link>
                  <Link to="/wishes"><ListChecks weight="duotone"/><span><strong>未来愿望</strong><small>把以后想做的事写下来</small></span></Link>
                  <Link to="/albums"><Images weight="duotone"/><span><strong>照片墙</strong><small>事件与事物，两本相册</small></span></Link>
                </section>
                <div className="home-columns">
                  <section className="recent">
                    <div className="section-title">
                      <h2>
                        最近的<span>小美好</span>
                        <span className="tiny-flower">✳</span>
                      </h2>
                      <Link to="/timeline">
                        全部回忆
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    <div className="memory-grid">
                      {memoriesLoading ? <MemoryLoadingCards count={2} /> : visible.slice(0, 2).map(card)}
                      {!memoriesLoading && visible.length === 0 && (
                        <div className="home-memory-empty">
                          <LockSimple weight="duotone"/>
                          <p>{visitorCanView(privacy, "timeline") ? "还没有写给访客看的时光。" : "这里的故事，登录后再慢慢翻。"}</p>
                        </div>
                      )}
                    </div>
                  </section>
                  <aside>
                    <div className="anniversary-paper">
                      <div className="paper-heading">
                        <CalendarBlank size={21} />
                        <h2>值得记住的日子</h2>
                        <Link to="/anniversaries" aria-label="查看全部纪念日">
                          <ArrowUpRight size={20} />
                        </Link>
                      </div>
                      {anniversariesLoading ? <AnniversaryLoadingRows /> : anniversaries
                        .slice(0, 4)
                        .map((a) => {
                          const d = anniversaryDays(a);
                          return (
                            <div className="anniversary-row" key={a.id}>
                              <div>
                                <strong>{a.title}</strong>
                                <small>{anniversaryLabel(a)}</small>
                              </div>
                              <span>
                                {d.kind === "countdown" ? "还有 " : "已经 "}
                                <b>{d.days}</b> 天
                              </span>
                            </div>
                          );
                        })}
                      <p className="paper-note">平凡的日历，因为你有了期待。</p>
                    </div>
                    <Link to="/places" className="places-promo">
                      <div>
                        <span className="small-caps">PLACES WITH YOU</span>
                        <h3>
                          把喜欢的地方，
                          <br />
                          都走成我们的足迹。
                        </h3>
                        <span className="subtle-link">
                          看看我们去过哪儿 <ArrowRight size={16} />
                        </span>
                      </div>
                      <GlobeHemisphereEast size={80} weight="duotone" />
                    </Link>
                  </aside>
                </div>
              </>
            ) : (
              <VisitorGate title="首页也暂时只留给我们" onLogin={() => setModal("login")}/>
            ))}
            {pathname === "/timeline" && (user || visitorCanView(privacy, "timeline") ? (
              <>
                {sectionHead(
                  "时光有迹，喜欢有声。",
                  "把散落在生活里的小美好，一页一页收好。",
                  user ? (
                    <button className="primary" onClick={() => openEdit()}>
                      <Plus size={20} aria-hidden="true" />
                      新增回忆
                    </button>
                  ) : undefined,
                )}
                <div className="filter-bar">
                  <div className="filter-tabs">
                    {["烟火日常", "小小幸福"].map((t) => (
                      <button
                        className={tag === t ? "active" : ""}
                        key={t}
                        onClick={() => setParams({ q, tag: t })}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <MagnifyingGlass />
                    <input
                      aria-label="搜索回忆"
                      placeholder="找找某一段回忆…"
                      value={q}
                      onChange={(e) => setParams({ q: e.target.value, tag })}
                    />
                  </label>
                </div>
                <div className="timeline-grid">
                  {memoriesLoading ? <MemoryLoadingCards count={4} /> : filtered.map(card)}
                </div>
                {!memoriesLoading && filtered.length === 0 && (
                  <div className="empty">
                    <Notebook size={42} />
                    <h2>这里还没有回忆</h2>
                    <p>换个关键词，或记下今天的故事。</p>
                  </div>
                )}
              </>
            ) : (
              <VisitorGate title="这些时光，等登录后再一起翻看" onLogin={() => setModal("login")}/>
            ))}
            {pathname.startsWith("/albums") && (
              <AlbumsPage user={user} onLogin={() => setModal("login")} albumId={pathname.startsWith("/albums/") ? decodeURIComponent(pathname.slice(8)) : null} publicAllowed={visitorCanView(privacy, "albums")} />
            )}
            {pathname === "/records" && <RecordsPage user={user} onLogin={() => setModal("login")} />}
            {pathname === "/play" && <PlayPage user={user} onLogin={() => setModal("login")} />}
            {pathname === "/wishes" && <WishesPage user={user} onLogin={() => setModal("login")} />}
            {pathname === "/places" && (user || visitorCanView(privacy, "places") ? (
              <>
                {sectionHead(
                  "世界很大，我们一起。",
                  "每一幅长卷，都是我们共同到过的一座城市。",
                  userRole === "ADMIN" ? (
                    <button className="primary" onClick={() => openPlace()}>
                      <Plus size={20} aria-hidden="true" />
                      上传长卷
                    </button>
                  ) : undefined,
                )}
                <section className="place-stories">
                    {placesLoading ? <PlaceLoadingCards /> : places.map((place, index) => (
                        <article className="custom-place" key={place.id}>
                          {place.panoramaImage && <img className="place-panorama" src={place.panoramaImage} alt={`${place.city}的旅行长卷`} />}
                          {(place.visitDate || place.description) && <div className="place-caption"><span>{place.visitDate?.replaceAll("-", ".")}</span><p>{place.description}</p></div>}
                          {userRole === "ADMIN" && <div className="place-admin-actions" aria-label={`${place.city}的管理操作`}>
                            <button onClick={() => movePlace(place.id, -1)} disabled={index === 0} aria-label={`上移${place.city}`}><ArrowUp/></button>
                            <button onClick={() => movePlace(place.id, 1)} disabled={index === places.length - 1} aria-label={`下移${place.city}`}><ArrowDown/></button>
                            <button onClick={() => openPlace(place)} aria-label={`编辑${place.city}`}><PencilSimple/></button>
                            <button onClick={() => deletePlace(place)} aria-label={`删除${place.city}`}><Trash/></button>
                          </div>}
                        </article>
                      ))}
                    {!placesLoading && places.length === 0 && (
                      <div className="empty module-empty">
                        <MapPin size={42} />
                        <h2>足迹还没有内容</h2>
                        <p>从这里添加第一个想记住的地点。</p>
                      </div>
                    )}
                </section>
              </>
            ) : (
              <VisitorGate title="足迹先留在两个人的地图里" onLogin={() => setModal("login")}/>
            ))}
            {pathname === "/anniversaries" && (user || visitorCanView(privacy, "anniversaries") ? (
              <>
                {sectionHead(
                  "日历里的偏爱。",
                  "有些日期，只是念起来就会微笑。",
                  user ? (
                    <button className="primary" onClick={() => openAnniversary()}>
                      <Plus size={20} aria-hidden="true" />
                      新增纪念日
                    </button>
                  ) : undefined,
                )}
                <div className="anniversary-grid">
                  {anniversariesLoading ? <AnniversaryLoadingCards /> : anniversaries.map((a, index) => {
                    const d = anniversaryDays(a);
                    return (
                      <article className="anniversary-paper" key={a.id}>
                        <div className="anniv-head">
                          <span className="anniv-icon">
                            <CalendarBlank size={17} />
                          </span>
                          <h2>{a.title}</h2>
                        </div>
                        <p>
                          {anniversaryLabel(a)}
                          {a.annual && (
                            <span className="anniv-tag">每年纪念</span>
                          )}
                          {a.lunar && (
                            <span className="next-lunar-date">
                              下次公历日期：{occurrence(a)}
                            </span>
                          )}
                        </p>
                        <div className="anniv-days">
                          <span>{d.kind === "countdown" ? "还有" : "已经"}</span>
                          <strong>{d.days}</strong>
                          <span>天</span>
                        </div>
                        {user && (
                          <div className="anniv-actions" aria-label={`${a.title}的操作`}>
                            <button onClick={() => moveAnniversary(a.id, -1)} disabled={index === 0} aria-label={`上移${a.title}`} title="上移">
                              <ArrowUp size={18} />
                            </button>
                            <button onClick={() => moveAnniversary(a.id, 1)} disabled={index === anniversaries.length - 1} aria-label={`下移${a.title}`} title="下移">
                              <ArrowDown size={18} />
                            </button>
                            <button onClick={() => openAnniversary(a)} aria-label={`编辑${a.title}`} title="编辑">
                              <PencilSimple size={18} />
                            </button>
                            <button className="danger" onClick={() => deleteAnniversary(a)} aria-label={`删除${a.title}`} title="删除">
                              <Trash size={18} />
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {user && !anniversariesLoading && (
                    <button
                      className="anniversary-paper add-card"
                      onClick={() => openAnniversary()}
                    >
                      <Plus size={20} aria-hidden="true" />
                      <span>再记一个值得记住的日子</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <VisitorGate title="特别的日子，登录后再慢慢数" onLogin={() => setModal("login")}/>
            ))}
            {pathname === "/admin" && (
              <>
                {sectionHead(
                  "整理我们的小世界。",
                  "每一段回忆，都值得被好好照顾。",
                )}
                {!user ? (
                  <div className="empty">
                    <LockSimple size={36} />
                    <h2>这是两个人的私密空间</h2>
                    <button
                      className="primary"
                      onClick={() => setModal("login")}
                    >
                      登录
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="admin-note">
                      <Gear />{" "}
                      {demo
                        ? "当前为演示管理，内容只保存在这个浏览器。"
                        : "双人共同维护；新记录默认私密。"}
                    </div>
                    {userRole === "ADMIN" && (
                      <section className="privacy-panel" aria-labelledby="privacy-title">
                        <div className="privacy-panel-heading">
                          <div className="privacy-panel-icon"><LockSimple weight="duotone"/></div>
                          <div>
                            <h2 id="privacy-title">访客可见设置</h2>
                            <p>这里决定未登录的人能够看到哪些内容，真正的数据权限也会在后端同步生效。</p>
                          </div>
                        </div>
                        <fieldset className="privacy-mode">
                          <legend>整站访客模式</legend>
                          <label className={privacyDraft.mode === "PRIVATE" ? "selected" : ""}>
                            <input type="radio" name="privacy-mode" checked={privacyDraft.mode === "PRIVATE"} onChange={() => setPrivacyDraft((value) => ({ ...value, mode: "PRIVATE" }))}/>
                            <span><strong>完全私密</strong><small>访客只能看到温柔的登录提示</small></span>
                          </label>
                          <label className={privacyDraft.mode === "SELECTED" ? "selected" : ""}>
                            <input type="radio" name="privacy-mode" checked={privacyDraft.mode === "SELECTED"} onChange={() => setPrivacyDraft((value) => ({ ...value, mode: "SELECTED" }))}/>
                            <span><strong>允许精选内容公开</strong><small>按照下面的模块范围对访客开放</small></span>
                          </label>
                        </fieldset>
                        <fieldset className="privacy-modules" disabled={privacyDraft.mode === "PRIVATE"}>
                          <legend>访客可以进入</legend>
                          {privacyModules.map(([key, label, description]) => (
                            <label key={key}>
                              <span><strong>{label}</strong><small>{description}</small></span>
                              <input type="checkbox" checked={privacyDraft[key]} onChange={(event) => setPrivacyDraft((value) => ({ ...value, [key]: event.target.checked }))}/>
                            </label>
                          ))}
                        </fieldset>
                        <div className="privacy-panel-footer">
                          <p>关闭某个模块后，首页仍可保留它的入口，访客点开时会看到私密提示。</p>
                          <button className="primary" onClick={savePrivacy} disabled={privacyBusy}>{privacyBusy ? "正在保存" : "保存访客设置"}</button>
                        </div>
                      </section>
                    )}
                    {memories.map((m) => (
                      <div className="admin-row" key={m.id}>
                        <div>
                          <strong>{m.title}</strong>
                          <small>
                            {m.deleted
                              ? "回收站"
                              : !m.published
                                ? "草稿"
                                : m.publicVisible
                                  ? "公开精选"
                                  : "双人私密"}{" "}
                            · {m.date}
                          </small>
                        </div>
                        {m.deleted ? (
                          <button onClick={() => remove(m, true)}>
                            <ArrowCounterClockwise />
                            恢复
                          </button>
                        ) : (
                          <div>
                            <button onClick={() => openEdit(m)}>编辑</button>
                            <button
                              aria-label={"删除" + m.title}
                              onClick={() => remove(m)}
                            >
                              <Trash />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
            {![
              "/",
              "/timeline",
              "/albums",
              "/places",
              "/admin",
              "/anniversaries",
              "/records",
              "/play",
              "/wishes",
            ].includes(pathname) && !pathname.startsWith("/albums/") && (
              <div className="empty">
                <h1>这一页，还没有写下故事。</h1>
                <Link to="/">回到首页</Link>
              </div>
            )}
          </>
        )}
      </main>
      <footer>
        <div className="brand-footer">
          <Heart weight="fill" size={15} />
          拾光
        </div>
        <p>把普通的日子，过成喜欢的样子。</p>
      </footer>
      <nav className="mobile-nav" aria-label="手机导航">
        {nav.map(([url, label, Icon]) => (
          <NavLink key={url} to={url}>
            <Icon size={23} />
            <span>{label}</span>
          </NavLink>
        ))}
        <NavLink to="/records">
          <DotsThreeCircle size={23} />
          <span>更多</span>
        </NavLink>
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check />
          {notice}
        </div>
      )}
      <Dialog.Root
        open={modal !== null}
        onOpenChange={(o) => {
          if (!o) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="modal">
            <Dialog.Close className="close" aria-label="关闭">
              <X />
            </Dialog.Close>
            <Dialog.Title>
              {modal === "login"
                ? "回到我们的小世界"
                : modal === "anniversary"
                  ? editingAnniversary
                    ? "修改这个特别的日子"
                    : "记住一个特别的日子"
                  : modal === "place"
                      ? editingPlace ? "整理这条足迹" : "上传一幅城市长卷"
                  : editing
                    ? "再写一点，这段回忆"
                    : "今天，有什么小美好？"}
            </Dialog.Title>
            <Dialog.Description>
              {modal === "login"
                ? demo
                  ? "当前是示例空间，进入后可体验编辑。"
                  : "只有你们两人可以登录，完整故事只对彼此可见。"
                : modal === "place"
                    ? "请上传已经制作完成的横向长卷，普通成员只能浏览。"
                : "不必是大事，想记住的就值得。"}
            </Dialog.Description>
            {modal === "login" ? (
              <form onSubmit={login}>
                <label>
                  账户
                  <input
                    name="username"
                    required
                    autoComplete="username"
                    defaultValue={demo ? couple.male : ""}
                  />
                </label>
                {!demo && (
                  <label>
                    密码
                    <input
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                )}
                {formError && (
                  <p className="error" role="alert">
                    {formError}
                  </p>
                )}
                <button className="primary" disabled={busy}>
                  {busy ? "正在进入…" : demo ? "进入示例空间" : "登录"}
                </button>
              </form>
            ) : modal === "anniversary" ? (
              <form
                key={editingAnniversary?.id || "new-anniversary"}
                onSubmit={saveAnniversary}
              >
                <label>
                  纪念日名称
                  <input
                    name="title"
                    required
                    maxLength={100}
                    defaultValue={editingAnniversary?.title}
                  />
                </label>
                <fieldset className="calendar-choice">
                  <legend>日期类型</legend>
                  <label className="checkbox">
                    <input
                      type="radio"
                      name="calendar"
                      checked={!anniversaryLunar}
                      onChange={() => setAnniversaryLunar(false)}
                    />
                    公历日期
                  </label>
                  <label className="checkbox">
                    <input
                      type="radio"
                      name="calendar"
                      checked={anniversaryLunar}
                      onChange={() => setAnniversaryLunar(true)}
                    />
                    农历日期
                  </label>
                </fieldset>
                {anniversaryLunar ? (
                  <div className="form-row">
                    <label>
                      农历月份
                      <select
                        name="lunarMonth"
                        defaultValue={editingAnniversary?.lunar?.month || 1}
                      >
                        {Array.from({ length: 12 }, (_, index) => index + 1).map(
                          (month) => (
                            <option key={month} value={month}>
                              {month} 月
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      农历日期
                      <select
                        name="lunarDay"
                        defaultValue={editingAnniversary?.lunar?.day || 1}
                      >
                        {Array.from({ length: 30 }, (_, index) => index + 1).map(
                          (day) => (
                            <option key={day} value={day}>
                              {day} 日
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                ) : (
                  <label>
                    日期
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={editingAnniversary?.date || today()}
                    />
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="annual"
                    defaultChecked={editingAnniversary?.annual ?? false}
                    disabled={anniversaryLunar}
                  />
                  每年重复
                </label>
                {anniversaryLunar && (
                  <p className="form-hint">
                    <CalendarBlank />农历日期会在每年自动换算为对应的公历日期。
                  </p>
                )}
                {formError && <p className="error" role="alert">{formError}</p>}
                <button className="primary" disabled={busy}>
                  {busy
                    ? "正在保存…"
                    : editingAnniversary
                      ? "保存修改"
                      : "保存纪念日"}
                </button>
              </form>
            ) : modal === "place" ? (
              <form key={editingPlace?.id || "new-place"} onSubmit={savePlace}>
                <label>
                  城市名
                  <input
                    name="city"
                    required
                    maxLength={60}
                    placeholder="例如：杭州"
                    defaultValue={editingPlace?.city}
                  />
                </label>
                <label>
                  到访日期
                  <input name="visitDate" type="date" defaultValue={editingPlace?.visitDate}/>
                </label>
                <label>
                  一句话说明
                  <textarea name="description" rows={2} maxLength={500} defaultValue={editingPlace?.description} placeholder="这座城市最想记住的是什么？"/>
                </label>
                <div className="photo-picker">
                  <span>城市长卷成图</span>
                  {placeImage ? <div className="photo-preview place-preview"><img src={placeImage} alt="城市长卷预览" /><button type="button" onClick={() => setPlaceImage("")}><X size={16} />移除</button></div> : <label className="upload-photo place-upload"><Camera size={20} />选择长卷图片<input type="file" accept="image/*" onChange={choosePlaceImage} /></label>}
                  <small>推荐 7:1，允许 6:1 至 8:1；上传后将完整展示，不会再次生成或裁切。</small>
                </div>
                {formError && <p className="error" role="alert">{formError}</p>}
                <button className="primary" disabled={busy}>{busy ? "正在保存…" : editingPlace ? "保存足迹" : "发布到足迹"}</button>
              </form>
            ) : (
              <form key={editing?.id || "new"} onSubmit={saveMemory}>
                <label>
                  给这一刻起个名字
                  <input
                    name="title"
                    required
                    maxLength={120}
                    defaultValue={editing?.title}
                  />
                </label>
                <label>
                  日期
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={editing?.date || today()}
                  />
                </label>
                <label>
                  想记住的故事
                  <textarea
                    name="body"
                    required
                    rows={4}
                    maxLength={20000}
                    defaultValue={editing?.body}
                    placeholder="今天，我们…"
                  />
                </label>
                <div className="photo-picker">
                  <span>配一张照片</span>
                  {imageData ? (
                    <div className="photo-preview">
                      <img src={imageData} alt="待发布照片预览" />
                      <button
                        type="button"
                        onClick={() => setImageData("")}
                        aria-label="移除照片"
                      >
                        <X size={16} />
                        移除
                      </button>
                    </div>
                  ) : (
                    <label className="upload-photo">
                      <Camera size={20} aria-hidden="true" />
                      选择照片
                      <input
                        type="file"
                        accept="image/*"
                        onChange={chooseImage}
                      />
                    </label>
                  )}
                  <small>支持 JPG、PNG、WebP，单张不超过 3MB</small>
                </div>
                <label>
                  归到哪一页
                  <select name="tag" defaultValue={editing?.tag || "烟火日常"}>
                    {["烟火日常", "小小幸福"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="publicVisible"
                    defaultChecked={editing?.publicVisible ?? false}
                  />
                  同时设为公开可见
                </label>
                <label>
                  公开摘要
                  <textarea
                    name="publicSummary"
                    rows={2}
                    maxLength={500}
                    defaultValue={editing?.publicSummary}
                    placeholder="公开时，给访客看的简短内容"
                  />
                </label>
                <div className="form-hint">
                  <LockSimple />
                  默认只在两个人之间分享；勾选公开可见时需要填写公开摘要。
                </div>
                {formError && (
                  <p className="error" role="alert">
                    {formError}
                  </p>
                )}
                <button className="primary" disabled={busy}>
                  {busy ? "正在保存…" : "收藏这一刻"}
                  <Heart size={17} />
                </button>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="modal detail">
            <Dialog.Close className="close" aria-label="关闭回忆">
              <X />
            </Dialog.Close>
            {selected && (
              <>
                {selected.image && (
                  <img
                    className="detail-photo"
                    src={selected.image}
                    alt={selected.title}
                  />
                )}
                <div className="detail-body">
                  <span className="meta">
                    {selected.date}
                  </span>
                  <Dialog.Title>{selected.title}</Dialog.Title>
                  <Dialog.Description className="story-body">
                    {user ? selected.body : selected.publicSummary}
                  </Dialog.Description>
                  <span className="tag">{selected.tag}</span>
                  <div className="detail-controls">
                    <button
                      onClick={() => {
                        const n = visible.findIndex(
                          (m) => m.id === selected.id,
                        );
                        setSelected(
                          visible[(n - 1 + visible.length) % visible.length],
                        );
                      }}
                    >
                      <ArrowLeft />
                      上一篇
                    </button>
                    {user && (
                      <button
                        onClick={() => {
                          openEdit(selected);
                          setSelected(null);
                        }}
                      >
                        编辑回忆
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const n = visible.findIndex(
                          (m) => m.id === selected.id,
                        );
                        setSelected(visible[(n + 1) % visible.length]);
                      }}
                    >
                      下一篇
                      <ArrowRight />
                    </button>
                  </div>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
