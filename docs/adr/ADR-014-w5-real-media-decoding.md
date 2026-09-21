# ADR-014 — W5: gerçek kayıtlarla kare çözme

> Tarih: 2026-09-21 · Durum: KABUL EDİLDİ

## Bağlam

Kullanıcı kendi 5 kaydını `web/tests/media/real/` klasörüne koydu. Bunlara
FFmpeg'in herkese açık örnek sunucusundan (samples.ffmpeg.org, hata kayıtları
2958, 5000, 5080) üç gerçek cihaz kaydı eklendi: iPhone 4 VFR, 59.94 fps
GoPro (Ambarella) ve 224×128 / 22 kHz eski bir iPhone yüklemesi. Hepsi
yalnızca yerelde, `.gitignore` altındaki klasörde. Depoya girmediler.

Klasörde HEVC, döndürme metadata'lı ya da HDR bir gerçek kayıt **yok**. O
türler hâlâ yalnızca sentetik matriste (M02, M10) sınanıyor.

## Bulgular ve kararlar

### 1. Siyah kareler: sessiz yanlış başarı (düzeltildi)

Chromium'da GoPro kaydının çıktısı 6.6 saniyenin yaklaşık 3.9 saniyesinde
**siyahtı** ve dışa aktarma "başarılı" diyordu. Sebep iki katmanlı:

- `VideoSampleSink.samplesAtTimestamps` her GOP geçişinde çözücüyü boşaltıyor
  (flush). Chromium'un yazılım H.264 çözücüsü bundan sonra bir GOP'luk kareyi
  teslim etmedi; sink o kareler için `null` verdi.
- Worker `null`'u sessizce arka plan rengiyle dolduruyordu; yalnızca **hiç**
  kare çözülemezse hata veriyordu.

Karar:

- Her an tek, kesintisiz bir çözme geçişiyle okunuyor
  (`VideoSampleSink.samples`). Çıktı ızgarasına eşleme `framePicker.ts` içinde,
  birim testli.
- Teslim edilmeyen kare artık sayılıyor. Ekrandaki kare, yerini almış olması
  gereken andan **bir çıktı karesinden (1/30 s) fazla** eskiyse eksik sayılıyor.
  Çıktının %2'sinden fazlası (en az 1) eksikse dışa aktarma
  `source_frames_missing` ile duruyor. Altındaysa sonuç ekranında
  "Çözülemeyen kare: N" satırı görünüyor.
- Tolerans ölçümden geldi: Chrome'un donanım çözücüsü aynı dosyada koşudan
  koşuya 2–8 **tek** kare düşürdü. Yerine gösterilen kare en fazla ~28 ms
  eskiydi, gözle görülmez. İlk (toleranssız) sürüm bu yüzden sağlam bir çıktıyı
  reddetti; bu fazla katıydı.

Sonuç: GoPro Chrome ve Edge'de 3'er tekrarda 3/3 PASS (SSIM 0.947). Sentetik
matris değişmedi (Chromium/Chrome/Edge 17/17).

### 2. Test referansı bir kare kaydırıyordu (ölçüm hatası, düzeltildi)

iPhone 4 kaydı (24.33 fps VFR) iki tarayıcıda da eşiğin hemen altındaydı ve
çıktı referansla bir kare kaydırılınca 0.91–0.94'e çıkıyordu. Hata
referanstaydı: `trim=from,setpts=PTS-STARTPTS`, `from` anında ekranda olan
kareyi atıp saati **bir sonraki** kareden başlatıyordu. Referans artık saati
`from`'a sabitliyor ve `fps=round=up` ile her kareyi bir sonraki başlayana dek
tutuyor. Bu, oynatıcının ve uygulamanın davranışı. iPhone kaydı: Chrome 0.937,
Chromium 0.914. Kare sayıları birebir.

### 3. Yazılım çözücüsü yanlış içerik veriyor (açık sınır)

Chromium'da GoPro kaydı düzeltmelerden sonra da SSIM 0.757. Siyah kare yok,
zaman damgaları Chrome'dakiyle birebir aynı ve sıralı. Ama resmin içeriği
0.4–0.5 s kadar **geride**. Gerçek Chrome ve Edge de
`--disable-accelerated-video-decode` ile aynı sonucu verdi (SSIM 0.804). Yani
donanım çözmesi olmayan gerçek bir kullanıcı da etkilenebilir.

Damgalar doğru olduğu için uygulama bu hatayı şu an **tespit edemiyor**. Destek
matrisine bilinen sınır olarak yazıldı. Olası yollar (henüz denenmedi): aynı
kareyi iki farklı çözme yoluyla alıp karşılaştıran bir ön kontrol, ya da yazılım
çözmede bu tür akışları güvenilmez sayıp uyarmak.

### 4. Koşucu kontrollü durdurmayı PASS sayıyordu (düzeltildi)

`run-real-media.mjs`, dışa aktarmanın açık bir hatayla durmasını geçerli bir
sonuç olarak PASS diye yazıyordu. Artık REFUSED. Doğru bir dürüst davranış,
ama çalışan bir dışa aktarma değil.

## Sonuç tablosu (8 gerçek kayıt)

| Tarayıcı | PASS | REFUSED | FAIL |
|---|---|---|---|
| Chrome | 8 | 0 | 0 |
| Edge | 8 | 0 | 0 |
| Chromium (Playwright) | 7 | 0 | 1 (R07, yazılım çözücü) |

## Hâlâ sınanmayanlar

Gerçek HEVC telefon kaydı, döndürme metadata'lı gerçek dikey kayıt, gerçek HDR
kayıt, 257.7 MiB'tan büyük ya da 32 dakikadan uzun gerçek kaynak. Bunlar için
en iyi kaynak kullanıcının kendi telefonu.
