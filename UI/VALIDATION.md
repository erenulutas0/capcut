# UI prototipinin doğrulaması — 20 Eylül 2026

## Gerçekten çalıştırılan ortam

Chromium **144.0.7559.96**, headless Playwright, Linux. HTML içerikleri `page.set_content` ile yerel dosyalardan tarayıcıya aktarıldı. Ortamdaki `file://` gezinmesi yönetim politikası nedeniyle engelli olduğu için çift tıklayarak dosya açma yolu burada test edilmedi. Görseller, CSS ve demo video HTML'e gömülü; test için harici hizmet veya CDN gerekmedi. Gerçek kullanıcı tarayıcısı, fiziksel telefon, Safari veya Firefox testi değildir.

41 otomatik kontrol çalıştırıldı; 41 PASS, 0 FAIL. Kontroller dar prototip davranışını ölçer, ürünün tamamını değil. Kaynak seçimi için paketin özgün 24sn MP4'ü, ayrı ses oynatma için test sırasında üretilen 3sn sinüs WAV kullanıldı. WAV bir müzik kataloğu değildir ve pakete eklenmedi.

| Kontrol | Sonuç |
|---|---|
| JavaScript syntax check | PASS |
| Editor overflow 1440x900 | PASS |
| 16:9 frame 1440x900 | PASS |
| Editor overflow 1366x768 | PASS |
| 16:9 frame 1366x768 | PASS |
| Editor overflow 1024x768 | PASS |
| 16:9 frame 1024x768 | PASS |
| Editor overflow 820x900 | PASS |
| 16:9 frame 820x900 | PASS |
| Editor overflow 390x844 | PASS |
| 16:9 frame 390x844 | PASS |
| Editor overflow 360x800 | PASS |
| 16:9 frame 360x800 | PASS |
| Editor overflow 320x740 | PASS |
| 16:9 frame 320x740 | PASS |
| Demo metadata is 24 seconds | PASS |
| Initial three clips total 14 seconds | PASS |
| Add range updates real list and duration | PASS |
| Reorder using non-drag button | PASS |
| Undo reorder | PASS |
| Redo reorder | PASS |
| Remove range | PASS |
| Undo removal | PASS |
| Invalid source range blocks addition | PASS |
| 9:16 preset has 9:16 geometry | PASS |
| Output mode shows assembled duration | PASS |
| Output 5s maps to source 9s | PASS |
| Actual sample playback advances | PASS |
| Export settings show not-implemented boundary | PASS |
| Export dialog Escape closes and restores trigger focus | PASS |
| Local file selection uses actual metadata and clears old clips | PASS |
| Audio file metadata is real | PASS |
| Separate audio preview actually plays | PASS |
| Phone moments sheet opens | PASS |
| Phone sheet Escape dismisses | PASS |
| Tablet has accessible moments entry | PASS |
| Tablet moments drawer opens | PASS |
| Landing overflow 1440x1040 | PASS |
| Landing overflow 390x844 | PASS |
| Landing overflow 320x740 | PASS |
| No browser JavaScript page errors | PASS |

## Ölçülen token çiftleri

W3C'nin sRGB göreli luminans formülüyle hesaplandı. Metinde 4.5:1; gerekli grafik/kontrol ayrımı için 3:1 karşılaştırma hedefi. Bu tablo tam WCAG uyumluluğu veya bütün hover/disabled/overlay renklerinin denetimi değildir. Kaynaklar: UI araştırma dosyasındaki U05/U07.

| Çift | Renkler | Hesaplanan oran | Karşılaştırma hedefi |
|---|---|---|---|
| Ana metin / zemin | #F3F5EE / #101315 | 16.97:1 | 4.5:1 |
| İkincil metin / panel | #ABB4AE / #181C1F | 8.06:1 | 4.5:1 |
| Accent metni / accent | #17200C / #D2EF78 | 13.10:1 | 4.5:1 |
| Landing metni / paper | #19211C / #F3F3EA | 14.75:1 | 4.5:1 |
| Kontrol sınırı / raised | #78837D / #22282B | 3.80:1 | 3:1 |
| Focus / panel | #B5DDFF / #181C1F | 12.04:1 | 3:1 |

## Görsel gözden geçirme

1440×900 editör, 1366×768 editör, 390×844 telefon genişliği editör/panel ve desktop landing ekranları görsel olarak incelendi. Önizlemenin seçili oranı koruması düzeltildi; kısa laptop ekranında alt şerit 170px’e indirildi. Diğer boyutlar da otomatik overflow/oran kontrolünden geçti. Ekran görüntüleri `screenshots/` içindedir.

## Test edilmedi / eksik olanlar

- **NOT_RUN:** fiziksel Android/iPhone, Safari/Firefox, TalkBack/VoiceOver/NVDA, gerçek 200% tarayıcı zoom, dokunma motor becerisi ve kullanıcı görüşmeleri.
- **NOT_IMPLEMENTED:** gerçek export/encoder, final audio mix, kalıcı proje/autosave, serbest crop, gerçek kaynak thumbnail üretimi, cloud, auth, ödeme, native uygulama.
- Telefon boyutu CSS adaptasyonudur; mobil tarayıcı encode desteği veya native eşdeğerliği anlamına gelmez.
- Listelerin yeniden çizilmesinden sonra bütün klavye focus durumları ve drawer modal/focus trap davranışları kapsamlı erişilebilirlik denetiminden geçmedi. Üretim uygulamasında UI sözleşmesindeki focus yönetimini tamamla.
- Kaynak/Sonuç örneği HTML video üzerinde temel sıralı preview'dur. Frame-accurate oynatma, ses eşlemesi ve nihai çıktı semantiği W1/W2 doğrulaması ister.
- Import edilen gerçek dosyada örnek sahne küçük görselleri açık yer tutucudur; uygulama bunu kaynak kareleri sanmamalı. Üretim UI gerçek thumbnail üretmeli veya nötr yer tutucu kullanmalıdır.
- Tüm fiyatlar, dönüşüm hedefleri ve kullanıcı rahatlığı varsayımları doğrulanmış sonuç değildir.

## Bir sonraki mühendislik adımı

Astra W0'da bu tasarımı tipli, bileşenlere ayrılmış gerçek UI'a uygular; W1'de 10 saniyelik gerçek browser export kanıtını verir. Bu HTML dosyasını production video motoru diye kopyalama.
