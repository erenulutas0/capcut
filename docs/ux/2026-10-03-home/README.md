# Açılış ekranı: görev öncelikli tasarım (kurucu kararı, 3 Ekim 2026)

Kurucu, editörle açılan ekranı yeterince kolay bulmadı: hedef "bir çocuğun bile istediğini
yapabileceği" bir ürün. Üç taslak çizildi (bu klasördeki `.dc.html` dosyaları, telefon
boyutunda, uygulamanın kendi renkleriyle):

- **A · İş kartları** — "Ne yapmak istiyorsun?" + büyük kartlar.
- **B · Önce video** — tek "Video seç" düğmesi, sonra "Bu videoyla ne yapalım?".
- **C · Yaz, bulalım** — arama kutusu ("videom WhatsApp'a sığmıyor" → Küçült), örnek
  cümleler, en çok kullanılan kartlar. Eşleştirme cihazda, eş anlamlı kelime listesiyle;
  yapay zekâ yok.

**Seçim: A + C birlikte.** Üstte arama kutusu, altında kartlar. Kart seçilince B'deki
"Video seç" adımı, sonra o işe özel 1–2 adım ve indirme. Editör "Kendim düzenleyeceğim"
bağlantısıyla kalır.

Araştırma özeti: 123apps / Clideo / VEED araç ızgarası kullanıyor ama onlarca–yüzlerce
araçla ve belirgin arama kutusu olmadan; göreve göre düzenlenmiş gezinme, özelliğe göre
düzenlenmişten daha kolay öğreniliyor (Avrupa Komisyonu web rehberi, Tampere Üniversitesi
vaka çalışması); yazarak bulma menüden hızlı ama tek başına bırakılmamalı.

Taslak tuvali: https://claude.ai/artifact/Q4V3e67pHd5KiAVLNU9rkW (özel bağlantı).

## Uygulandı (3 Ekim 2026)

Karar kaydı: [ADR-034](../../adr/ADR-034-task-first-home.md). Taslaklardan farklar:

- Taslaklarda sekiz kart vardı; **yalnızca çalışan yedi işin** kartı gösteriliyor (Kes,
  Boşlukları at, Dikey yap, Küçült, Müzik ekle, Sesini al, Her yerde açılsın; Küçült ve
  Sesini al ADR-035 ile eklendi). Yazıya dök hazır olunca kartı kendiliğinden gelir
  (kayıtta tek satır).
- Taslak C'nin "En çok kullanılanlar" başlığı yok (kullanım ölçmüyoruz); başlık "Bütün işler".
- Kutudaki örnek "videom WhatsApp’a sığmıyor" değil "sessiz yerleri sil": örnek, bugün
  çalışan bir işe götürmeli. (WhatsApp cümlesi artık Küçült'ü buluyor; "Bu henüz yok,
  üzerinde çalışıyoruz." cümlesini bugün yalnızca Yazıya dök'ü kasteden aramalar alıyor.)
- Taslak B'nin "Bu videoyla ne yapalım?" listesi yok: önce iş seçiliyor, "Video seç"
  sihirbazın ilk adımı.

Ekran görüntüleri (çalışan uygulamadan, Playwright; `web/scripts/home-shots.mjs`),
`shots/` altında, her biri 360, 390 ve 1440 px genişlikte (`-360`, `-390`, `-1440`):

| Dosya | Ekran |
|---|---|
| `01-home` | Açılış ekranı |
| `02-search-results` | Arama: "tiktok için dikey" → Dikey yap |
| `03-search-two-results` | Arama: "sesi kes" → Kes + Sesini al |
| `04-search-unavailable` | Arama: "altyazı ekle" → "Bu henüz yok" |
| `60-kucult-2-choice`, `61-kucult-3-saved` | Küçült: üç hedef ve her birinin sonucu → kaydedildi, gerçek boyut hedefe karşı |
| `70-ses-2-info`, `71-ses-3-saved` | Sesini al: tek açıklama → "Ses dosyası kaydedildi" |
| `80-yazi-2-model`, `81-yazi-2-ready`, `82-yazi-2-running` | Yazıya dök (ADR-036): "Modeli indir (≈108,8 MB, bir kez)" → model hazır, "Yazıya dök" → gerçek sayılarla ilerleme |
| `83-yazi-2-result`, `84-yazi-2-correcting`, `85-yazi-3-saved` | Sonuç: yazı paneli (etkin satır işaretli), metin / SRT / VTT, "Altyazılı videoyu indir" → bir satırı yerinde düzeltme → kaydedildi |
| `86-yazi-editor-panel`, `87-yazi-editor-kesit-from-text` | Editörde "Kesitler \| Yazı": iki satır işaretli, "Bunlardan kesit yap" → "Kesitler" sekmesinde yazıdan yapılan kesit |

`80`–`87` gerçek modelle (Whisper `base`, bu makinede) ve gerçek bir cümleyle çekildi
(`web/tests/media/speech-fleurs-en-01.mp4`, FLEURS, CC BY 4.0); görüntü siyahtır çünkü test
videosunun görüntüsü siyahtır. Üretim: `node scripts/home-shots.mjs --only=yazi`.
| `90-iyilestir-0-home`, `91-iyilestir-0-search-honest` | İyileştir (ADR-037): dokuz kartlı açılış ekranı; arama "4K yap" → İyileştir, dürüst satırıyla ("Çok bulanık bir videoyu netleştiremez.") |
| `92-iyilestir-2-choice`, `93-iyilestir-2-strong` | Videonun gerçek bir karesinin öncesi ve sonrası (çizgi ortada; "Güçlü"de çizgi sola çekilmiş), "Yapılacaklar: …", Hafif / Otomatik / Güçlü |
| `94-iyilestir-3-saved` | Kaydedildi: "Görüntü yeniden işlendi (iyileştirme her kareyi değiştiriyor)" ve "İyileştirildi (Otomatik): …" |
| `95-iyilestir-editor-setting` | Editörde Ayarlar → Görüntü → "Görüntüyü iyileştir" ve aynı öncesi/sonrası |
| `96-iyilestir-2-nothing` | Düzeltilecek bir şeyi olmayan video (test deseni): "değiştirilecek bir şey bulunamadı", İndir kapalı ve sebebi yazılı |
| `05-search-none` | Arama: "Bunu bulamadım" |
| `10-kes-1-pick`, `11-kes-2-editor` | Kes: video seç → kesit editörü (ilk açılış ipucuyla) |
| `20-bosluk-2-choice`, `21-bosluk-3-saved` | Boşlukları at: bulunanlar ve karar → kaydedildi |
| `30-dikey-1-pick` … `34-dikey-3-saved` | Dikey yap: video seç, "Doldur", "Sığdır", hazırlanıyor, kaydedildi |
| `40-muzik-2-no-music`, `41-muzik-2-choice`, `42-muzik-3-saved` | Müzik ekle: müzik seçilmeden, seçilince, kaydedildi |
| `50-cevir-2-info`, `51-cevir-3-saved` | Her yerde açılsın: açıklama ("zaten uygun" notuyla), kaydedildi |

Görüntülerdeki videolar ffmpeg ile üretilmiş test desenleridir; gerçek çekim yok. `90`–`96`
için karanlık, kamera görüntüsü gibi ölçülen bir sahne yine ffmpeg ile üretildi (renk geçişleri
üstünde fraktal gürültü; `web/tests/e2e/enhance-media.ts`); üretim:
`node scripts/home-shots.mjs --only=iyilestir`.
