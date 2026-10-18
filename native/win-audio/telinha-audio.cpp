// telinha-audio.exe — captura o som de um processo só (Windows 10 2004+ / 11)
//
// Uso:
//   telinha-audio.exe --include-hwnd <HWND>   som só do app dessa janela (e dos filhos dele)
//   telinha-audio.exe --include-pid <PID>     som só desse processo (e dos filhos)
//   telinha-audio.exe --exclude-pid <PID>     som do PC inteiro menos esse processo (e filhos)
//
// Saída: PCM 16-bit, 48 kHz, estéreo, intercalado, no stdout (binário).
// Mensagens em texto vão no stderr: "ready" quando a captura começa, "error: ..." se falhar.
// Encerra sozinho quando o stdin fecha (o Telinha morreu ou parou a captura).

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <objidl.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwchar>

// Estruturas de audioclientactivationparams.h (nem todo mingw traz esse header)
enum TelinhaActivationType { TELINHA_ACTIVATION_DEFAULT = 0, TELINHA_ACTIVATION_PROCESS_LOOPBACK = 1 };
enum TelinhaLoopbackMode { TELINHA_LOOPBACK_INCLUDE_TREE = 0, TELINHA_LOOPBACK_EXCLUDE_TREE = 1 };
struct TelinhaLoopbackParams {
  DWORD TargetProcessId;
  TelinhaLoopbackMode ProcessLoopbackMode;
};
struct TelinhaActivationParams {
  TelinhaActivationType ActivationType;
  TelinhaLoopbackParams ProcessLoopbackParams;
};

static const wchar_t kProcessLoopbackDevice[] = L"VAD\\Process_Loopback";

typedef HRESULT(WINAPI *ActivateAudioInterfaceAsyncFn)(
    LPCWSTR, REFIID, PROPVARIANT *, IActivateAudioInterfaceCompletionHandler *,
    IActivateAudioInterfaceAsyncOperation **);

static void fail(const char *what, HRESULT hr) {
  fprintf(stderr, "error: %s (0x%08lx)\n", what, (unsigned long)hr);
  fflush(stderr);
  ExitProcess(1);
}

// O ActivateAudioInterfaceAsync exige um handler COM "ágil" (IAgileObject)
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient *client = nullptr;

  STDMETHODIMP QueryInterface(REFIID riid, void **out) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *out = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *out = static_cast<IAgileObject *>(this);
    } else {
      *out = nullptr;
      return E_NOINTERFACE;
    }
    return S_OK;
  }
  // Vive na pilha do main até o fim: contagem de referência não importa
  STDMETHODIMP_(ULONG) AddRef() override { return 2; }
  STDMETHODIMP_(ULONG) Release() override { return 1; }

  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *op) override {
    IUnknown *unk = nullptr;
    HRESULT activateHr = E_FAIL;
    result = op->GetActivateResult(&activateHr, &unk);
    if (SUCCEEDED(result)) result = activateHr;
    if (SUCCEEDED(result) && unk) {
      result = unk->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void **>(&client));
    }
    if (unk) unk->Release();
    SetEvent(done);
    return S_OK;
  }
};

static bool writeAll(HANDLE out, const void *data, DWORD size) {
  const char *p = static_cast<const char *>(data);
  while (size > 0) {
    DWORD written = 0;
    if (!WriteFile(out, p, size, &written, nullptr) || written == 0) return false;
    p += written;
    size -= written;
  }
  return true;
}

// Sai quando o stdin fecha: o Telinha encerrou (ou fechou o pipe pra parar)
static DWORD WINAPI watchStdin(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char buf[64];
  DWORD read = 0;
  while (ReadFile(in, buf, sizeof(buf), &read, nullptr) && read > 0) {
  }
  ExitProcess(0);
  return 0;
}

int wmain(int argc, wchar_t **argv) {
  if (argc < 3) {
    fprintf(stderr, "error: uso: telinha-audio.exe --include-hwnd|--include-pid|--exclude-pid <n>\n");
    return 2;
  }
  const wchar_t *flag = argv[1];
  unsigned long long value = wcstoull(argv[2], nullptr, 10);
  DWORD pid = 0;
  TelinhaLoopbackMode mode = TELINHA_LOOPBACK_INCLUDE_TREE;
  if (wcscmp(flag, L"--include-hwnd") == 0) {
    GetWindowThreadProcessId(reinterpret_cast<HWND>(static_cast<UINT_PTR>(value)), &pid);
  } else if (wcscmp(flag, L"--include-pid") == 0) {
    pid = static_cast<DWORD>(value);
  } else if (wcscmp(flag, L"--exclude-pid") == 0) {
    pid = static_cast<DWORD>(value);
    mode = TELINHA_LOOPBACK_EXCLUDE_TREE;
  }
  if (pid == 0) {
    fprintf(stderr, "error: processo nao encontrado\n");
    return 3;
  }

  CreateThread(nullptr, 0, watchStdin, nullptr, 0, nullptr);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) fail("CoInitializeEx", hr);

  // Carrega dinamicamente: em Windows antigo a função não existe e saímos com erro claro
  HMODULE mmdevapi = LoadLibraryW(L"Mmdevapi.dll");
  auto activate = mmdevapi ? reinterpret_cast<ActivateAudioInterfaceAsyncFn>(
                                 GetProcAddress(mmdevapi, "ActivateAudioInterfaceAsync"))
                           : nullptr;
  if (!activate) fail("ActivateAudioInterfaceAsync indisponivel", E_NOTIMPL);

  TelinhaActivationParams params = {};
  params.ActivationType = TELINHA_ACTIVATION_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = mode;

  PROPVARIANT prop = {};
  prop.vt = VT_BLOB;
  prop.blob.cbSize = sizeof(params);
  prop.blob.pBlobData = reinterpret_cast<BYTE *>(&params);

  ActivationHandler handler;
  IActivateAudioInterfaceAsyncOperation *op = nullptr;
  hr = activate(kProcessLoopbackDevice, __uuidof(IAudioClient), &prop, &handler, &op);
  if (FAILED(hr)) fail("ActivateAudioInterfaceAsync", hr);
  WaitForSingleObject(handler.done, INFINITE);
  if (op) op->Release();
  if (FAILED(handler.result) || !handler.client) fail("ativar captura do processo", handler.result);
  IAudioClient *client = handler.client;

  // Process loopback não tem GetMixFormat: nós escolhemos o formato e o Windows converte
  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                          200000, 0, &format, nullptr);
  if (FAILED(hr)) fail("IAudioClient::Initialize", hr);

  HANDLE sampleReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->SetEventHandle(sampleReady);
  if (FAILED(hr)) fail("SetEventHandle", hr);

  IAudioCaptureClient *capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void **>(&capture));
  if (FAILED(hr)) fail("GetService(IAudioCaptureClient)", hr);

  hr = client->Start();
  if (FAILED(hr)) fail("IAudioClient::Start", hr);

  fprintf(stderr, "ready\n");
  fflush(stderr);

  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  static BYTE silence[48000 * 4];
  for (;;) {
    // Sem som tocando o Windows não manda pacotes; o Telinha preenche com silêncio
    WaitForSingleObject(sampleReady, 1000);
    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE *data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) fail("GetBuffer", hr);
      DWORD bytes = frames * format.nBlockAlign;
      // Pacotes têm ~10 ms; o buffer de silêncio cobre 1 s
      bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) && bytes <= sizeof(silence);
      bool ok = writeAll(out, silent ? silence : data, bytes);
      capture->ReleaseBuffer(frames);
      if (!ok) return 0;  // pipe fechado: o Telinha parou de ler
    }
  }
}
