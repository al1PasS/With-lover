import { createContext, useContext, useEffect, useState } from "react";
import { request } from "./api/client";

const demo = import.meta.env.VITE_DEMO !== "false";
const identityKey = "shiguang:demo-username";
export function demoIdentity(user: string) {
  return sessionStorage.getItem(identityKey) || user;
}
export function demoMemberName(id: string) {
  return localStorage.getItem(`shiguang:demo-nickname:${id}`) || id;
}
export function rememberDemoName(user: string, nickname: string) {
  const id = demoIdentity(user);
  sessionStorage.setItem(identityKey, id);
  localStorage.setItem(`shiguang:demo-nickname:${id}`, nickname);
  sessionStorage.setItem("shiguang:demo-user", nickname);
}
type Member = { id: number; name: string };
export const Members = createContext<readonly Member[]>([]);
export function useMemberDirectory(user: string | null) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    if (!user || demo) {
      setMembers([]);
      return;
    }
    let controller: AbortController | undefined;
    function refresh() {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const next = new AbortController();
      controller = next;
      void request<Member[]>("/auth/members", { signal: next.signal })
        .then((rows) => {
          if (!next.signal.aborted && Array.isArray(rows)) setMembers(rows);
        })
        .catch(() => {});
    }
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, 60000);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(interval);
    };
  }, [user]);
  return user ? members : [];
}
export function usePostAuthor() {
  const members = useContext(Members);
  return (id?: number | string | null, legacy?: string | null) =>
    (demo && typeof id === "string"
      ? demoMemberName(id)
      : members.find((member) => member.id === id)?.name) ||
    legacy ||
    "未署名";
}
