import { rememberDemoName } from "./members";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeSlash, LockSimple, UserCircle } from "@phosphor-icons/react";
import { request, resetCsrf } from "./api/client";

const demo = import.meta.env.VITE_DEMO !== "false";
type Profile = import("./api/schema").components["schemas"]["AccountProfile"];
type Result = { profile: Profile; loginRequired: boolean };
function PasswordInput({
  id,
  label,
  autoComplete,
  minLength,
  describedBy,
}: {
  id: string;
  label: string;
  autoComplete: string;
  minLength?: number;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <div className="account-password">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          required
          maxLength={200}
          minLength={minLength}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${visible ? "隐藏" : "显示"}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeSlash /> : <Eye />}
        </button>
      </div>
    </div>
  );
}
export default function ProfileSettings({
  user,
  onSaved,
}: {
  user: string;
  onSaved: (
    nickname: string,
    loginRequired: boolean,
    username: string,
  ) => Promise<void> | void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [nickname, setNickname] = useState(""),
    [username, setUsername] = useState("");
  const [busy, setBusy] = useState<"profile" | "password" | null>(null),
    [loadError, setLoadError] = useState(""),
    [profileError, setProfileError] = useState(""),
    [passwordError, setPasswordError] = useState(""),
    [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setProfile(null);
    setLoadError("");
    (async () => {
      try {
        const value = demo
          ? {
              id: 1,
              username:
                sessionStorage.getItem("shiguang:demo-username") || user,
              nickname: user,
              role: "ADMIN" as const,
            }
          : await request<Profile>("/account/profile");
        if (active) {
          setProfile(value);
          setNickname(value.nickname);
          setUsername(value.username);
        }
      } catch (e) {
        if (active) setLoadError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, retry]);
  async function save(
    e: FormEvent<HTMLFormElement>,
    kind: "profile" | "password",
  ) {
    e.preventDefault();
    if (!profile || busy) return;
    const form = e.currentTarget,
      fields = new FormData(form);
    setProfileError("");
    setPasswordError("");
    setMessage("");
    const renamed = kind === "profile" && username !== profile.username;
    if (kind === "profile" && !nickname.trim()) {
      setProfileError("昵称不能为空");
      return;
    }
    if (
      kind === "password" &&
      fields.get("newPassword") !== fields.get("confirmPassword")
    ) {
      setPasswordError("两次输入的新密码不一致");
      form.querySelector<HTMLInputElement>("#confirmPassword")?.focus();
      return;
    }
    setBusy(kind);
    try {
      const input =
        kind === "profile"
          ? {
              nickname: nickname.trim(),
              ...(renamed
                ? { username, oldPassword: fields.get("renameOldPassword") }
                : {}),
            }
          : {
              oldPassword: fields.get("oldPassword"),
              newPassword: fields.get("newPassword"),
            };
      const result = demo
        ? {
            profile: { ...profile, nickname: nickname.trim() },
            loginRequired: false,
          }
        : await request<Result>("/account/profile", {
            method: "PATCH",
            body: JSON.stringify(input),
          });
      if (demo) rememberDemoName(user, result.profile.nickname);
      setProfile(result.profile);
      setNickname(result.profile.nickname);
      setUsername(result.profile.username);
      form.reset();
      if (result.loginRequired) resetCsrf();
      setMessage(
        result.loginRequired
          ? "账号已更新，请使用新的登录信息重新登录。"
          : "个人信息已保存。 ",
      );
      await onSaved(
        result.profile.nickname,
        result.loginRequired,
        result.profile.username,
      );
    } catch (e) {
      (kind === "profile" ? setProfileError : setPasswordError)(
        (e as Error).message,
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="account-panel" aria-labelledby="account-title">
      <div className="account-heading">
        <span className="account-icon">
          <UserCircle size={28} weight="duotone" />
        </span>
        <div>
          <span className="small-caps">YOUR OWN LITTLE SPACE</span>
          <h2 id="account-title">个人信息</h2>
          <p>管理自己的昵称、登录用户名和密码。</p>
        </div>
      </div>
      {loadError ? (
        <div className="error" role="alert">
          {loadError}
          <button onClick={() => setRetry((x) => x + 1)}>
            重新加载个人信息
          </button>
        </div>
      ) : !profile ? (
        <p role="status">正在读取个人信息…</p>
      ) : (
        <>
          {demo && (
            <p className="account-demo">
              演示模式可体验昵称修改；用户名和密码维护请在真实账号下操作。
            </p>
          )}
          <div className="account-forms">
            <form
              onSubmit={(e) => void save(e, "profile")}
              aria-label="维护个人资料"
            >
              <h3>我的资料</h3>
              <fieldset disabled={busy !== null}>
                <div className="account-field">
                  <label htmlFor="account-nickname">昵称</label>
                  <input
                    id="account-nickname"
                    name="nickname"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={40}
                    required
                    autoComplete="nickname"
                  />
                  <small>显示在发帖、评论、愿望单和最近更新中，最多 40 字。</small>
                </div>
                <div className="account-field">
                  <label htmlFor="account-username">登录用户名</label>
                  <input
                    id="account-username"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={demo}
                    required
                    minLength={username !== profile.username ? 3 : undefined}
                    maxLength={40}
                    pattern={username !== profile.username ? "[a-zA-Z0-9_]{3,40}" : undefined}
                    autoComplete="username"
                    aria-describedby="username-help"
                  />
                  <small id="username-help">
                    3–40 位字母、数字或下划线。修改后需重新登录。
                  </small>
                </div>
                {!demo && username !== profile.username && (
                  <PasswordInput
                    id="renameOldPassword"
                    label="当前密码（修改用户名）"
                    autoComplete="current-password"
                  />
                )}
                {profileError && (
                  <p className="account-error" role="alert">
                    {profileError}
                  </p>
                )}
                <button className="primary" type="submit">
                  {busy === "profile" ? "正在保存…" : "保存个人信息"}
                </button>
              </fieldset>
            </form>
            <form
              onSubmit={(e) => void save(e, "password")}
              aria-label="修改登录密码"
            >
              <h3>
                <LockSimple aria-hidden="true" />
                修改密码
              </h3>
              <p className="account-help" id="password-help">
                验证旧密码后才能修改。修改成功后，所有设备需重新登录。
              </p>
              <fieldset disabled={demo || busy !== null}>
                <PasswordInput
                  id="oldPassword"
                  label="旧密码"
                  autoComplete="current-password"
                />
                <PasswordInput
                  id="newPassword"
                  label="新密码"
                  autoComplete="new-password"
                  minLength={8}
                  describedBy="new-password-help"
                />
                <small id="new-password-help">
                  使用 8–200 位密码，支持粘贴和密码管理器。
                </small>
                <PasswordInput
                  id="confirmPassword"
                  label="确认新密码"
                  autoComplete="new-password"
                  minLength={8}
                />
                {passwordError && (
                  <p className="account-error" role="alert">
                    {passwordError}
                  </p>
                )}
                <button className="primary" type="submit">
                  {busy === "password" ? "正在修改…" : "修改密码"}
                </button>
              </fieldset>
            </form>
          </div>
          {message && (
            <p className="account-success" role="status">
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
