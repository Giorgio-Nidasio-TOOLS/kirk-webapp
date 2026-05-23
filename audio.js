let _recorder = null;
let _chunks = [];

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  _chunks = [];
  _recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  _recorder.ondataavailable = (e) => {
    if (e.data.size > 0) _chunks.push(e.data);
  };
  _recorder.start();
}

export function stopRecording() {
  return new Promise((resolve) => {
    _recorder.onstop = async () => {
      const blob = new Blob(_chunks, { type: "audio/webm" });
      _recorder.stream.getTracks().forEach((t) => t.stop());
      _recorder = null;
      const b64 = await _blobToBase64(blob);
      resolve(b64);
    };
    _recorder.stop();
  });
}

export function isRecording() {
  return _recorder?.state === "recording";
}

function _blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.readAsDataURL(blob);
  });
}
