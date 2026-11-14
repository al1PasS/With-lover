import { useEffect, useRef, useState } from "react";

type Stage = "idle" | "requesting" | "recording" | "preparing";
type Capture = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  reader?: FileReader;
};

function release({ stream, recorder, reader }: Capture) {
  if (recorder) {
    recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
    if (recorder.state !== "inactive") recorder.stop();
  }
  if (reader?.readyState === FileReader.LOADING) reader.abort();
  stream?.getTracks().forEach((track) => track.stop());
}

export function useVoiceRecording() {
  const capture = useRef<Capture | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [audio, setAudio] = useState("");
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      const current = capture.current;
      capture.current = null;
      if (current) release(current);
    },
    [],
  );

  async function toggle() {
    const current = capture.current;
    if (current) {
      if (current.recorder?.state === "recording") {
        setStage("preparing");
        current.recorder.stop();
      }
      return;
    }
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("录音需要支持麦克风的浏览器和安全连接。");
      return;
    }
    if (typeof MediaRecorder !== "function") {
      setError("当前浏览器不支持网页录音，请换用 Chrome 或 Safari。");
      return;
    }

    const next: Capture = {};
    capture.current = next;
    setStage("requesting");
    function finish(message = "") {
      if (capture.current !== next) return;
      capture.current = null;
      release(next);
      setError(message);
      setStage("idle");
    }
    try {
      next.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (capture.current !== next) {
        release(next);
        return;
      }
      // Prefer AAC for sharing with Apple and Android browsers when the encoder is available.
      const aac = "audio/mp4;codecs=mp4a.40.2";
      const recorder = MediaRecorder.isTypeSupported?.(aac)
        ? new MediaRecorder(next.stream, { mimeType: aac })
        : new MediaRecorder(next.stream);
      next.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data);
      };
      recorder.onerror = () => finish("录音中断了，请重新录一段。");
      recorder.onstop = () => {
        next.stream?.getTracks().forEach((track) => track.stop());
        if (capture.current !== next) return;
        if (!chunks.length) {
          finish("没有录到声音，请重新录一段。");
          return;
        }
        setStage("preparing");
        const reader = new FileReader();
        next.reader = reader;
        reader.onload = () => {
          if (capture.current !== next) return;
          if (typeof reader.result !== "string") {
            finish("无法读取录音，请重新录一段。");
            return;
          }
          setAudio(reader.result);
          finish();
        };
        reader.onerror = () => finish("无法读取录音，请重新录一段。");
        const type = (
          chunks.find((chunk) => chunk.type)?.type || recorder.mimeType
        ).split(";")[0];
        if (!type) {
          finish("无法识别录音格式，请换用其他浏览器。");
          return;
        }
        reader.readAsDataURL(new Blob(chunks, { type }));
      };
      recorder.start();
      setStage("recording");
    } catch (cause) {
      finish(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "请在浏览器设置中允许拾光使用麦克风，然后重试。"
          : "无法开始录音，请检查麦克风后重试。",
      );
    }
  }

  return {
    stage,
    audio,
    error,
    toggle,
    clear: () => {
      setAudio("");
      setError("");
    },
    invalidPreview: () => {
      setAudio("");
      setError("这段录音无法试听，请重新录一段。");
    },
  };
}

export function SavedVoice({ audio }: { audio: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <audio
        controls
        preload="metadata"
        aria-label="播放语音"
        src={audio}
        onError={() => setFailed(true)}
        onLoadedMetadata={() => setFailed(false)}
      />
      {failed && (
        <p className="post-feedback" role="alert">
          这段录音无法播放，可换浏览器试试。
        </p>
      )}
    </>
  );
}
