# "GIF yap" — onaylanan taslak ve uygulanan ekran (17 Ekim 2026)

Karar kaydı: [ADR-046](../../adr/ADR-046-gif.md). Kurucu, taslak tuvalindeki seçeneklerden **B "Tek ekran,
yazı önizlemenin üstünde"**yi seçti. Tuval: <https://claude.ai/artifact/7aEpqFUdm3XJ3YGoVH1xNc> (çizim
dosyası `B-TekEkran.dc.html`; buradaki kopya kayıt içindir, tuvalin `support.js`'i olmadan açılmaz —
içindeki satır içi stiller yalnız taslağındır, uygulama Quiet Studio belirteçlerini kullanır).

## Taslakta olan, uygulamada nasıl

| Taslak (B) | Uygulama |
|---|---|
| Videoyu seçtikten sonra tek ekran | Sihirbazın 2. adımı (Adım 2 / 3): önizleme, kısım çubuğu, boyut, tek düğme. "Daha fazla ayar → editörde aç" yok (editör GIF yapmaz) |
| GIF önizlemesi döngüde oynar | Seçilen kısım sessiz, durmadan döner (`requestVideoFrameCallback`, yoksa `timeupdate`); altında "Önizlemeyi durdur" düğmesi (kendiliğinden hareket eden her şey durdurulabilir) |
| Üstteki / alttaki kesik çizgili kutuya dokun ve yaz; boş = yazı yok | Aynen. Kutu GIF'in kendi harfleriyle (Inter Bold, altyazı yazı tipi), GIF'teki boyutta yazar ve iki satıra GIF'in kırdığı yerden kırar; doluyken çizgi vurgu renginde. Enter "bitti" demektir (yeni satır değil); en çok 40 harf |
| "Yazının üstüne dokun ve yaz. Boş bırakırsan yazı olmaz." | Aynen, önizlemenin altında |
| Kısmı seçen çubuk, "Kaydırarak kısmı seç" | Videonun boyu kadar bir çubuk, üstünde seçili kısım: çubuğa basıp sürükle (kısım taşınır; kısmın dışına basınca kısım oraya gelir), kenarlarını sürükle (uzar / kısalır). Üçü de klavyeyle kaydırıcı (oklar 0,5 sn, Shift 2 sn, Home/End) |
| En çok 10 sn | 10 sn'de durur ve söyler: "GIF en çok 10 saniye olabilir." |
| "4 sn · yaklaşık 3 MB" | "4,0 sn · yaklaşık 141 KB" — tahmin değil ölçüm: kısmın dört yerinden ikişer kare GIF'in kendi yoluyla kodlanır |
| — (taslakta yok) | "Boyut: Küçük / Orta" (görevde istenen; videonun kendisi Küçük'ten büyük değilse yalnız bir cümle: "Bu video küçük; GIF videonun kendi boyutunda olur.") |
| "GIF'i indir" | Aynen; kaydetme penceresi (Chrome/Edge) ya da "Kaydet" bağlantısı; sonra Adım 3 / 3: gerçek ilerleme ("Kareler hazırlanıyor: 23 / 50"), İptal, "Kaydedildi" + ne kaydedildiği ("143 KB · 4,0 sn · durmadan döner"), Paylaş, "Bir GIF daha yap" |

Taslaktan bilerek ayrılınan: dosya adı satırı (adı ve "Değiştir") önizlemenin altında durur — her sihirbazda
orada; taslakta yoktu.

## Ekranlar (uygulama, bu dalın test kancalı derlemesi, Playwright Chromium)

- Telefon 390 × 844: [yazılı](uygulama-telefon-yazili.png) · [kaydedildi](uygulama-telefon-kaydedildi.png) · [ana ekran, on bir kart](uygulama-telefon-ana-ekran.png)
- Masaüstü 1440 × 900: [yazılı](uygulama-masaustu-yazili.png) · [kaydedildi](uygulama-masaustu-kaydedildi.png) · [ana ekran](uygulama-masaustu-ana-ekran.png)
- Aynı yazılarla kaydedilen GIF'in ilk karesi, ffmpeg'le çözülmüş: [gif-ilk-kare.png](gif-ilk-kare.png) — önizlemedeki satır kırılımıyla aynı

Ana ekran: on bir kartta öndeki "Kes" kartı iki yer kaplar (telefonda tam genişlik; masaüstünde iki kart genişliğinde, yanında iki kart: 3 + 4 + 4),
böylece hiçbir satırda tek kart kalmaz. Bu, taslağın konusu değildi; kurucunun bakması için ADR-046'da
"Kurucu kararları"nda.
