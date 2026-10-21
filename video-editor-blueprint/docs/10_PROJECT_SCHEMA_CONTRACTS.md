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
- `origin`: `manual` (editörde yazıldı) | `imported` (SRT/VTT'den geldi).
- `timeBase`: `output` (satır zamanları sonuç videosuna göre) | `source` (satır zamanları `assetId` ile gösterilen video dosyasına göre). `source` izde `assetId` zorunludur ve bir video kaynağı olmalıdır; satırlar o videonun süresi içinde kalır (`range_out_of_source`). `output` izde `assetId` bulunmaz. Kaynak zamanlı satırlar sonuç videosunda anlarla birlikte taşınır, aynı bölüm iki kez kullanılırsa iki kez görünür (ADR-016). Bu genişletme 2026-09-21'de v2 içinde yapıldı; öncesinde yazılmış v2 tarifler aynen geçerlidir.
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

## EDL v3 — transkript izi (2026-10-04, kurucu kararı; ADR-036)

v3, v2'nin aynısıdır; altyazı izine üç **genişletme** gelir. Hiçbir v2 alanı değişmez ya da
kalkmaz, bu yüzden v2 tarif kayıpsız okunur: yalnızca `schemaVersion` 3 yapılır (v1 önce v2
kuralıyla `captionTracks: []` alır). Geçerli her v2 tarif, numarası değişince geçerli bir v3
tariftir; fixture'lar `web/fixtures/edl/legacy-v2/`.

```json
"captionTracks": [
  {
    "trackId": "t_001",
    "origin": "transcript",
    "timeBase": "source",
    "assetId": "a_video_001",
    "language": "en",
    "style": { "preset": "box", "position": "bottom", "size": "medium" },
    "cues": [
      { "cueId": "q_001", "startUs": 1000000, "endUs": 3200000, "text": "He hoped there would be\nstew for dinner," }
    ],
    "unclear": [ { "startUs": 6000000, "endUs": 8000000 } ]
  }
]
```

- `origin`: `manual` | `imported` | **`transcript`** (cihaz üstü transkriptten geldi; makine
  yazdı, arayüz bunu söyler).
- **`unclear`** (isteğe bağlı): konuşma duyulan ama yazılamayan kaynak aralıkları, yarı açık
  `[startUs, endUs)`. Yalnızca `origin: "transcript"` **ve** `timeBase: "source"` olan izde
  bulunabilir (başka izde `caption_track_invalid`); sıralıdır, birbirinin üstüne binmez
  (`caption_cue_overlap`), videonun süresi içindedir (`range_out_of_source`), tam sayı
  mikrosaniyedir. Transkript panelinde "(anlaşılamadı)" satırı olarak görünür; **videoya
  çizilmez, SRT/VTT'ye yazılmaz**. Bir satır aynı aralığa elle yazılınca o aralık panelde bir
  daha gösterilmez (veri silinmez). İz sonuç zamanına çevrilirse ya da bir altyazı dosyası içe
  aktarılırsa `unclear` kaldırılır.
- **Satır sınırı:** iz başına en çok **3000** satır (v2'de 500) ve en çok 3000 `unclear` aralığı.
  Gerekçe ve ölçülen bedel: ADR-036 "Satır sınırı".
- Kelime zamanları saklanmaz; transkript, satırlarından ve `unclear` aralıklarından ibarettir.

## EDL v4 — görüntü iyileştirme ayarı (2026-10-07, kurucu kararı; ADR-037)

v4, v3'ün aynısıdır; tarife **isteğe bağlı tek bir ana alan** gelir. Hiçbir v3 alanı değişmez ya
da kalkmaz, bu yüzden v3 tarif kayıpsız okunur: yalnızca `schemaVersion` 4 yapılır (v1 ve v2 önce
kendi kurallarıyla yükselir). Geçerli her v3 tarif, numarası değişince iyileştirmesi **kapalı**
geçerli bir v4 tariftir; fixture'lar `web/fixtures/edl/legacy-v3/`. Eski sürüm numarası taşıyıp
bu alanı içeren bir dosyayı hiçbir derleme yazmadı: yükseltilmez, doğrulayıcı reddeder.

```json
"enhance": { "strength": "auto" }
```

- **`enhance`** (isteğe bağlı): "İyileştir" her indirmeye uygulanır. Alan yoksa kapalıdır
  (varsayılan); kapatmak alanı kaldırır, tarif ayarın hiç olmadığı hâline döner.
- `strength`: `light` | `auto` | `strong` (arayüzde Hafif / Otomatik / Güçlü). Başka değer
  `enhance_invalid`; nesne değilse `not_an_object`; başka alan `unknown_field`.
- Tarif yalnızca **isteği** taşır. Her karede ne yapılacağı (ışık, renk, keskinlik, kumlanma
  ölçüleri) tarifte saklanmaz: indirme sırasında videonun kendisine bakılarak hesaplanır
  (`web/src/domain/enhance.ts`), böylece aynı tarif başka bir videoyla da doğru çalışır ve
  motorun ölçüleri değişince eski projeler kendiliğinden yenisini kullanır.
- Render planına `enhance: { strength } | null` olarak geçer ve parmak izine **yalnızca açıkken**
  girer (motor sürümüyle birlikte): iyileştirmesi kapalı bir tarifin parmak izi v3'teki ile
  aynıdır. Açıkken hızlı kesim (ADR-027) uygulanmaz: iyileştirilmiş video kopya olamaz.

## EDL v5 — satırda konuşan (2026-10-13, kurucu kararı; ADR-043)

v5, v4'ün aynısıdır; transkript izinin **satırına isteğe bağlı tek bir alan** gelir. Hiçbir v4 alanı
değişmez ya da kalkmaz, bu yüzden v4 tarif kayıpsız okunur: yalnızca `schemaVersion` 5 yapılır (v1,
v2 ve v3 önce kendi kurallarıyla yükselir). Geçerli her v4 tarif, numarası değişince hiçbir satırı
konuşan adı taşımayan geçerli bir v5 tariftir; fixture'lar `web/fixtures/edl/legacy-v4/`. Eski sürüm
numarası taşıyıp bu alanı içeren bir dosyayı hiçbir derleme yazmadı: yükseltilmez, doğrulayıcı
reddeder (`schema_version_unsupported`).

```json
"cues": [
  { "cueId": "q_001", "startUs": 1000000, "endUs": 3200000, "text": "Merhaba, başlayalım mı?", "speaker": 1 },
  { "cueId": "q_002", "startUs": 3400000, "endUs": 5000000, "text": "Olur, hazırım.", "speaker": 2 },
  { "cueId": "q_003", "startUs": 9000000, "endUs": 11000000, "text": "Elle yazılan satır" }
]
```

- **`speaker`** (isteğe bağlı): satırı kimin söylediği, **sıra numarası** olarak: videoda ilk duyulan
  ses 1, sonraki 2 … en çok **20**. Bir ad değildir, bir kimlik değildir; arayüz "1. kişi", "2. kişi"
  diye gösterir. Alan yoksa bilinmiyordur (cihazda yazılan, elle yazılan, dosyadan gelen her satır).
  `null` ya da `0` "bilinmiyor" demek **değildir**: bilinmeyen satırda alan hiç bulunmaz.
- Yalnızca `origin: "transcript"` olan izin satırında bulunabilir (zaman tabanı fark etmez); başka
  izde `caption_track_invalid`. 1–20 arası tam sayı değilse (`0`, `21`, `1.5`, `"1"`, `null`)
  **`caption_speaker_invalid`**.
- Numaralar 1'den başlamak ya da boşluksuz olmak zorunda değildir: bir kişinin bütün satırları
  silinince ötekilerin numarası değişmez (etiketler kullanıcının gözü önünde yeniden numaralanmaz).
- **İz düzeyinde alan yoktur** (kişi sayısı, ad tablosu): sayı satırlardan türetilir, ayrı tutulsa
  satırlarla çelişebilirdi; adlandırma bir arayüz kararı bekliyor (ADR-043 "Kurucu kararları").
  `speakers` gibi bir iz alanı `unknown_field`'dir.
- Düzenleme kuralları (komutlar bunları uygular, ADR-043): metni ya da zamanı değişen satır
  konuşanını **korur**; bir satır kesitlere göre parçalanırsa her parça aynı konuşanı taşır; yalnızca
  **aynı satırın** parçaları yeniden birleşir, iki ayrı satır hiç birleştirilmez (bir satır iki kişinin
  sözünü taşımaz); elle eklenen satırın konuşanı yoktur; izi yeniden kuran her şey (altyazı dosyası
  içe aktarma, cihazda yeniden yazıya dökme) konuşanları eski satırlarla birlikte götürür.
- **Videoya çizilmez.** Render planı ve parmak izi `speaker`'ı hiç okumaz: konuşanı olan bir tarifin
  planı, alanı silinmiş aynı tarifin planıyla parmak izine kadar aynıdır. Dosyalarda: TXT ses
  değişen satırda adı yazar; **VTT** her satırda ses etiketi taşır (`<v 1. kişi>metin`); **SRT taşımaz**
  (SRT'de metnin önüne yazılan ad, dosyayı okuyan her program için metnin kendisi olurdu). Etiketler
  yalnızca izde en az iki ayrı konuşan varsa gösterilir ve yazılır.

## EDL v6 — editörde "Sesi düzelt" (2026-10-21, kurucunun devrettiği karar; ADR-050)

v6, v5'in aynısıdır; tarife **isteğe bağlı tek bir ana alan** gelir. Hiçbir v5 alanı değişmez ya da
kalkmaz, bu yüzden v5 tarif kayıpsız okunur: yalnızca `schemaVersion` 6 yapılır (v1…v4 önce kendi
kurallarıyla yükselir; hepsi doğrudan v6'ya gelir). Geçerli her v5 tarif, numarası değişince sesi
düzeltilmeyen (ayar **kapalı**) geçerli bir v6 tariftir: eski bir projenin indirmesi aynı sesle çıkar.
Fixture'lar `web/fixtures/edl/legacy-v5/`. Eski sürüm numarası taşıyıp bu alanı içeren bir dosyayı
hiçbir derleme yazmadı: yükseltilmez, doğrulayıcı reddeder (`schema_version_unsupported`).

```json
"soundFix": { "targetLufs": -16 }
```

- **`soundFix`** (isteğe bağlı): editörün her indirmesinde **bütün karışık ses** (videonun sesi ve
  müzik birlikte) cihazda ölçülür ve "Sesi düzelt" kartının zinciriyle (ADR-049,
  `web/src/domain/soundFix.ts`) hedefe getirilir; dosyanın gerçek tepesi en çok −1 dBTP. Alan yoksa
  kapalıdır (varsayılan); kapatmak alanı kaldırır, tarif ayarın hiç olmadığı hâline döner.
- `targetLufs`: yalnızca **−16** (zincirin `TARGET_LUFS`'ı). Başka bir sayı ya da metin (`-23`,
  `"-16"`, alan yok) **`sound_fix_invalid`**; nesne değilse `not_an_object`; başka alan
  `unknown_field`. Sayı tarifte yazılıdır ki tarif ne istediğini söylesin; bilinmeyen bir hedef
  sessizce −16 diye okunmaz.
- Tarif yalnızca **isteği** taşır. Kazançlar (giriş/çıkış, dB) tarifte saklanmaz: her indirmede o
  indirmenin karışımının kendisi iki geçişte ölçülür (`İyileştir`'in ölçüleri gibi), böylece kesitler,
  ses düzeyleri ya da müzik değişince sonuç kendiliğinden doğru kalır.
- Render planına `soundFix: { targetLufs } | null` olarak geçer ve parmak izine **yalnızca açıkken**
  girer (zincir sürümüyle birlikte): ayarı kapalı bir tarifin parmak izi v5'teki ile aynıdır. Açıkken
  **hızlı kesim (ADR-027) değişmez**: ses zaten her indirmede yeniden kodlanır, görüntü izin verilen
  her videoda kopyalanır.

## Doğrulama kuralları

`schemaVersion=6` (v1, v2, v3, v4 ve v5 okunurken yukarıdaki geçişlerle yükseltilir); bilinmeyen ana alanlar ilk sürümde hata verir. Alan genişletme ihtiyacı değişiklik kaydıyla ele alınır. `projectId/assetId/clipId` sınırlı uzunlukta opaque kimliktir. Her `assetId` tekil; klipte referans verilen asset `video`; müzik asset'i `audio` olmalıdır. Tüm sayılar finite; NaN/Infinity kabul edilmez.

Zamanlar güvenli integer ve ≥0; JSON'da stringe çevrilmez. JavaScript safe-integer sınırı korunur. `0 ≤ in < out ≤ probedDuration`; her klip ≥100.000 µs. Düzenlemede tekrarlanan/örtüşen kaynak aralıkları geçerlidir; örneğin aynı sahnenin tekrar gösterilmesi mümkündür. Çıktı timeline'ında klipler ardışık ve boşluksuzdur; konum dizi sırasından türetilir.

`view` normalize edilmiş, orientation sonrası görüntü koordinatıdır: x/y≥0, width/height>0, x+width≤1, y+height≤1. Kabul edilen hassasiyet ve float karşılaştırma epsilon'u fixture'larla tanımlanır; kırpma koordinatları zaman gibi integer olma zorunluluğu taşımaz.

Gain mute hariç −60…0 dB; fade değerleri ≥0, toplamı müzik seçiminin süresini aşamaz. Müzik timeline başlangıcı çıktı süresinden küçük olmalı; çıktı dışına taşan son kısmı render planı keser. Süre ve byte limitleri [politikadan](15_PRICING_FREE_PRO.md) gelir; domain formatının kendisi plan adlarını hardcode etmez. Tarifin toplam süresi (zaman çizgisi) en çok girdi süresi sınırı kadar olabilir (`timeline_duration_exceeds_policy`); çıktı süresi sınırı tarifin kuralı değildir, render planı uygular (`output_duration_exceeds_policy`): çıktı sınırından uzun bir zaman çizgisi geçerli bir projedir, açılır, kaydedilir ve geri alınır, yalnızca indirilemez (ADR-021).

Cloud, istemcinin `durationUs`, çözünürlük, MIME veya toplam süre beyanını yetkilendirme kaynağı yapmaz. Gerçek probe sonuçları ile recipe eşleşir; farklılık varsa kullanıcıya yeni quote/uyumsuzluk durumu döner.

## Repository alanları

`ProjectRecord`: EDL, schema version, revision, created/updated UTC, asset binding list, save state. `AssetBinding`: yerel opaque ID, platform URI/handle, permission state, boyut, isteğe bağlı yerel fingerprint, probe sonucu, erişim tarihi. `ExportAttempt`: attempt ID, recipe fingerprint, engine/version, route, state, sanitized failure, output binding.

`ProjectRecord` içindeki EDL, yukarıdaki doğrulama kurallarından tek bir noktada ayrılır: `clips` boş olabilir. Kesit listesi akışında video açıldığında hiçbir kesit eklenmez ve bu durum kaydedilen olağan bir projedir; kayıt (ve yedek dosyası) bu yüzden boş `clips` ile okunur. Dışa aktarılan tarif için kural değişmez: boş `clips` geçersizdir (`clips_empty`, fixture `invalid/empty-clips.json`); indirme, videonun tamamını kapsayan tek kesitli tarifi kendisi üretir. Gerekçe: depo kökündeki `docs/adr/ADR-012-w3-local-persistence.md`, "Ek, 10 Ekim 2026".

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

Migrations ileri yönde test edilir; eski dosyaya doğrudan destructive rewrite yapılmaz. Desteklenmeyen gelecek sürüm read-only hata verir.

**Geri yol yoktur (2026-10-13, ADR-043).** Web uygulamasında kayıtlı proje ilk açılışta güncel sürüm numarasıyla yeniden yazılır (otomatik kayıt; değişen tek şey numaradır). Tarayıcı sonradan uygulamanın **daha eski** bir kopyasını açarsa (service worker'ın sakladığı kabuk, sürümler arasında açık kalmış sekme) o kopya daha yüksek numaralı tarifi **okumaz ve üstüne yazmaz**: kayıt `edl_newer` olarak ayrılır (bozuk kayıttan — `edl_invalid` — farklı), başlık "Bu proje daha yeni bir sürümle saklanmış. Sayfayı yenile. Bu sayfada yaptıkların saklanmaz." der ve otomatik kayıt o sekmede durur. Bu koruma v5 derlemesiyle geldi; ondan önceki derlemeler (v4 ve öncesi) yüksek numaralı kaydı "bozuk" sayar, yüklemez, ama o sekmede yeni bir video açılırsa üstüne yazar — ayrıntı ve kalan pencere ADR-043'te. Export fingerprint kanonik recipe, çözülmüş asset kimlikleri/içerik sürümleri, politika ve engine sürümünü içerir; UI seçimi veya updated timestamp'i gibi semantiği etkilemeyen değerleri içermez.

Fingerprint cache anahtarı olabilir, fakat başka kullanıcının özel videosunu global hash eşleşmesiyle ona açmak yasaktır. Cloud dedupe yalnızca aynı owner/job bağlamında değerlendirilir.

## İlk ortak fixture seti

Geçerli: tek klip, çok klip, aynı kaynaktan tekrar, sessiz kaynak, gecikmeli müzik, kare/portre çıktı. Geçersiz: negatif zaman, ters aralık, unknown asset, crop taşması, süre limiti aşımı, unsupported codec spec, fazla klip, müzik fade taşması, future schema.

v5 ile eklenenler (`web/fixtures/edl/`, 2026-10-13): geçerli `caption-transcript-speakers`, `caption-transcript-speaker-highest`; geçersiz `caption-speaker-zero`, `-too-high`, `-not-integer`, `-not-a-number`, `-null` (`caption_speaker_invalid`), `caption-speaker-on-manual-track`, `-on-imported-track` (`caption_track_invalid`), `caption-track-speakers-field` (`unknown_field`); `future-schema` artık 6; `legacy-v4/` (dördü geçerli, `v4-with-speaker` geçersiz).

v6 ile eklenenler (2026-10-21, ADR-050): geçerli `sound-fix-on`, `sound-fix-with-music-and-enhance`; geçersiz `sound-fix-other-target`, `-target-as-text`, `-no-target` (`sound_fix_invalid`), `sound-fix-unknown-field` (`unknown_field`), `sound-fix-not-an-object` (`not_an_object`); `future-schema` artık 7; `legacy-v5/` (dördü geçerli, `v5-with-sound-fix` geçersiz).

Dart, TypeScript ve Python aynı fixture dosyalarını okuyup aynı valid/invalid sonucunu üretmeden sözleşme tamamlanmış sayılmaz.
