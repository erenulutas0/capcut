# 10 — Proje Tarifi, Domain Modeli ve Motor Sözleşmeleri

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Kanonik EDL v1

EDL, tahribatsız bir düzenleme tarifidir. Dosyaları taşımaz; yalnızca asset kimlikleri ve düzenleme semantiği içerir. Yerel URI, blob URL, imzalı URL, erişim token'ı, şarkı lisansı veya kullanıcı e-postası bu taşınabilir tarifin alanı değildir. Kaynak kimliğinin gerçek dosyaya eşlemesi ayrı repository'dedir.

Aşağıdaki örnek **10 saniye** sonuç üretir: ilk aralık 0–4, ikinci aralık 8–14 saniye. Müzik, ses dosyasının 5–15 saniyesidir. Bu JSON parse edilebilir sözleşme örneğidir; gerçek medya veya uygulanmış JSON Schema dosyası değildir.

```json
{
  "schemaVersion": 1,
  "projectId": "p_example_001",
  "revision": 3,
  "assets": [
    {
      "assetId": "a_video_001",
      "kind": "video",
      "durationUs": 20000000,
      "displayWidth": 1080,
      "displayHeight": 1920,
      "hasAudio": true
    },
    {
      "assetId": "a_music_001",
      "kind": "audio",
      "durationUs": 30000000
    }
  ],
  "canvas": {
    "aspect": "9:16",
    "background": "#000000"
  },
  "clips": [
    {
      "clipId": "c_001",
      "assetId": "a_video_001",
      "sourceInUs": 0,
      "sourceOutUs": 4000000,
      "sourceGainDb": 0,
      "muted": false,
      "view": {
        "x": 0,
        "y": 0,
        "width": 1,
        "height": 1,
        "fit": "cover"
      }
    },
    {
      "clipId": "c_002",
      "assetId": "a_video_001",
      "sourceInUs": 8000000,
      "sourceOutUs": 14000000,
      "sourceGainDb": -6,
      "muted": false,
      "view": {
        "x": 0,
        "y": 0,
        "width": 1,
        "height": 1,
        "fit": "cover"
      }
    }
  ],
  "music": {
    "assetId": "a_music_001",
    "sourceInUs": 5000000,
    "sourceOutUs": 15000000,
    "timelineStartUs": 0,
    "gainDb": -12,
    "muted": false,
    "fadeInUs": 250000,
    "fadeOutUs": 500000
  },
  "export": {
    "container": "mp4",
    "videoCodec": "h264",
    "audioCodec": "aac",
    "shortEdge": 1080,
    "fpsNum": 30,
    "fpsDen": 1,
    "colorMode": "sdr_rec709",
    "audioSampleRate": 48000
  }
}
```

## EDL v2 — altyazı izleri (2026-09-21, kurucu onaylı)

v2, v1'in aynısıdır; yalnızca zorunlu bir `captionTracks` dizisi eklenir (ayrıntı ve gerekçe: `docs/adr/ADR-015-captions-burn-in.md`). v1 tarif kayıpsız okunur: `schemaVersion` 2 yapılır ve `captionTracks: []` eklenir, başka hiçbir alan değişmez. Okuyan her yol (yerel kayıt, yedek dosyası, fixture) bu geçişten geçer; doğrulayıcının kendisi yalnızca güncel sürümü tanır.

```json
"captionTracks": [
  {
    "trackId": "t_001",
    "origin": "manual",
    "timeBase": "output",
    "language": "tr",
    "style": { "preset": "box", "position": "bottom", "size": "medium" },
    "cues": [
      { "cueId": "q_001", "startUs": 500000, "endUs": 3000000, "text": "İlk an: güneş doğuyor" }
    ]
  }
]
```

Kurallar:
- En çok 1 iz, iz başına en çok 500 satır.
- `origin` yalnızca `manual`; `timeBase` yalnızca `output`. Kaynak zamanına bağlı ya da transkriptten türetilen satırlar bu alanla ileride şema geçişi olmadan eklenebilir; bugün reddedilir.
- `language`: BCP 47 ana dil kodu, isteğe bağlı olarak bölge ile (`tr`, `en`, `en-GB`).
- `style`: yalnızca hazır değerler kabul edilir.
  - `preset`: `box` | `outline`
  - `position`: `bottom` | `middle` | `top`
  - `size`: `small` | `medium` | `large`

  Serbest renk ya da font yoktur: önizleme ile dosya aynı görünmek zorundadır.
- Satırlar `startUs`'e göre sıralıdır ve üst üste binmez; aralık yarı açıktır `[startUs, endUs)` ve en az 200.000 µs sürer.
- `text` düz metindir, kanonik biçimde saklanır:
  - satır sonu yalnızca LF;
  - kontrol ve sıfır genişlikli karakterler silinir;
  - satır içindeki boşluklar tek boşluğa indirilir ve satırlar kırpılır;
  - en çok 120 kod noktası ve 2 satır.

  Metin, kendi normalleştirilmiş hâline eşit değilse geçersizdir.
- Bir satır çıktının sonunu aşabilir; bu geçerlidir. Anlar kısalınca satır silinmez; render planı onu çıktı sonunda keser, tamamen dışarıda kalanı çizmez, arayüz de bunu gösterir.

## Doğrulama kuralları

`schemaVersion=2` (v1 okunurken yukarıdaki geçişle yükseltilir); bilinmeyen ana alanlar ilk sürümde hata verir. Alan genişletme ihtiyacı değişiklik kaydıyla ele alınır. `projectId/assetId/clipId` sınırlı uzunlukta opaque kimliktir. Her `assetId` tekil; klipte referans verilen asset `video`; müzik asset'i `audio` olmalıdır. Tüm sayılar finite; NaN/Infinity kabul edilmez.

Zamanlar güvenli integer ve ≥0; JSON'da stringe çevrilmez. JavaScript safe-integer sınırı korunur. `0 ≤ in < out ≤ probedDuration`; her klip ≥100.000 µs. Düzenlemede tekrarlanan/örtüşen kaynak aralıkları geçerlidir; örneğin aynı sahnenin tekrar gösterilmesi mümkündür. Çıktı timeline'ında klipler ardışık ve boşluksuzdur; konum dizi sırasından türetilir.

`view` normalize edilmiş, orientation sonrası görüntü koordinatıdır: x/y≥0, width/height>0, x+width≤1, y+height≤1. Kabul edilen hassasiyet ve float karşılaştırma epsilon'u fixture'larla tanımlanır; kırpma koordinatları zaman gibi integer olma zorunluluğu taşımaz.

Gain mute hariç −60…0 dB; fade değerleri ≥0, toplamı müzik seçiminin süresini aşamaz. Müzik timeline başlangıcı çıktı süresinden küçük olmalı; çıktı dışına taşan son kısmı render planı keser. Süre ve byte limitleri [politikadan](15_PRICING_FREE_PRO.md) gelir; domain formatının kendisi plan adlarını hardcode etmez.

Cloud, istemcinin `durationUs`, çözünürlük, MIME veya toplam süre beyanını yetkilendirme kaynağı yapmaz. Gerçek probe sonuçları ile recipe eşleşir; farklılık varsa kullanıcıya yeni quote/uyumsuzluk durumu döner.

## Repository alanları

`ProjectRecord`: EDL, schema version, revision, created/updated UTC, asset binding list, save state. `AssetBinding`: yerel opaque ID, platform URI/handle, permission state, boyut, isteğe bağlı yerel fingerprint, probe sonucu, erişim tarihi. `ExportAttempt`: attempt ID, recipe fingerprint, engine/version, route, state, sanitized failure, output binding.

Proje JSON paylaşımı sonraki fazda sunulsa bile karşı tarafın kaynak medyaya sahip olması gerekir. “Aynı hesapla giriş yaptın, video diğer cihazda otomatik açıldı” davranışı MVP kapsamında yoktur.

## Motor portu

Aşağıdaki arayüz implementasyon değil, davranış sözleşmesidir:

```typescript
interface MediaEngine {
  probe(assetHandle: string): Promise<ProbeResult>;
  assess(project: ProjectV1, policy: ExportPolicy): Promise<CapabilityReport>;
  preparePreview(project: ProjectV1): Promise<PreviewSession>;
  export(request: ExportRequest): AsyncIterable<ExportEvent>;
  cancel(attemptId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

`ExportEvent`: `preparing`, `encoding`, `finalizing`, `saving`, `succeeded`, `failed`, `canceled`. Yüzde sadece ölçülebilen safhada nullable `progress` olarak gönderilir. `succeeded` bir kez gelir, çıktıya erişim bilgisi içerir. Başarısızlık açık hata enum'u taşır; raw yerel path veya secret taşımaz. Dart/Kotlin/Swift tarafında karşılığı typed DTO'dur.

Her preview oturumunun yaşam döngüsü ve dispose sorumlusu nettir. Eski revision için gelen asenkron thumbnail/probe sonucu yeni projeyi bozamaz; request/revision etiketiyle elenir.

## Otomatik kayıt ve geçmiş

Domain değişikliği → revision artışı → kısa debounce → transactional local save. Önerilen debounce 500 ms, uygulama pasifleşirken best-effort flush; ani OS kill'de mutlak sıfır kayıp garantisi verilmez. Kaydetme hata verirse belirgin “Kaydedilemedi” uyarısı, kullanıcıya EDL'yi dışa alma kurtarma yolu.

Undo/redo için en az son 100 küçük komut hedeflenir; büyük medya payload'ı geçmişe yazılmaz. Pro version snapshots, bu temel geri almanın ücretli hale getirilmesi değildir. Dosya silmek sadece projedeki referansı siler; kullanıcının galeri kaynağına dokunmaz.

## Sürümleme ve render fingerprint

Migrations ileri yönde test edilir; eski dosyaya doğrudan destructive rewrite yapılmaz. Desteklenmeyen gelecek sürüm read-only hata verir. Export fingerprint kanonik recipe, çözülmüş asset kimlikleri/içerik sürümleri, politika ve engine sürümünü içerir; UI seçimi veya updated timestamp'i gibi semantiği etkilemeyen değerleri içermez.

Fingerprint cache anahtarı olabilir, fakat başka kullanıcının özel videosunu global hash eşleşmesiyle ona açmak yasaktır. Cloud dedupe yalnızca aynı owner/job bağlamında değerlendirilir.

## İlk ortak fixture seti

Geçerli: tek klip, çok klip, aynı kaynaktan tekrar, sessiz kaynak, gecikmeli müzik, kare/portre çıktı. Geçersiz: negatif zaman, ters aralık, unknown asset, crop taşması, süre limiti aşımı, unsupported codec spec, fazla klip, müzik fade taşması, future schema.

Dart, TypeScript ve Python aynı fixture dosyalarını okuyup aynı valid/invalid sonucunu üretmeden sözleşme tamamlanmış sayılmaz.
