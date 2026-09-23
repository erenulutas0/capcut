# ADR-014 — W5: gerçek kayıtlarla kare çözme

> Tarih: 2026-09-21 · Durum: KABUL EDİLDİ

## Bağlam

Kullanıcı kendi 5 kaydını `web/tests/media/real/` klasörüne koydu. Bunlara
FFmpeg'in herkese açık örnek sunucusundan (samples.ffmpeg.org, hata kayıtları
2958, 5000, 5080) üç gerçek cihaz kaydı eklendi: iPhone 4 VFR, 59.94 fps
GoPro (Ambarella) ve 224×128 / 22 kHz eski bir iPhone yüklemesi. Hepsi
yalnızca yerelde, `.gitignore` altındaki klasörde. Depoya girmediler.

İkinci turda yedi gerçek telefon kaydı daha eklendi (R09–R15). Kaynaklar:
immich-app/test-assets (kamu malı), androidx/media test verisi (Apache-2.0),
pulsejet/memories (depo lisansı AGPL-3.0; medya için ayrı lisans yok) ve
archive.org (CC BY-NC-ND / CC BY-ND). Kaynak ve lisans kaydı yerelde
`web/tests/media/real/SOURCES-web.md` dosyasında. Kapsam: iPhone 12 Pro HEVC
HLG/Dolby Vision döndürmeli, Pixel 6 Pro HEVC 4K döndürmeli, Samsung HEVC
slow-motion (12 kHz ses), Android HEVC HDR10+ (PQ), iPhone 13 Pro 60 fps
180° döndürmeli, Samsung S21 H.264 60 fps döndürmeli, iPhone 11 5 dk 41 sn
618 MiB.

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

### 3. Yazılım çözücüsü kare atlıyordu: SPS yeniden sıralamayı az bildiriyor (düzeltildi)

Belirti: Chromium'da GoPro kaydı SSIM 0.757. Gerçek Chrome ve Edge
`--disable-accelerated-video-decode` ile 0.804. Zaman damgaları doğru ve
sıralıydı ama resim her GOP'ta biraz daha geride kalıyordu.

**Kök neden (ölçüldü).** GoPro'nun SPS'i `bitstream_restriction_flag = 1`,
`max_num_reorder_frames = 1`, `max_dec_frame_buffering = 6` diyor
(`ffmpeg -bsf:v trace_headers`). Oysa akış her B grubunu P, B(ref), B, B
sırasıyla kodluyor. Her GOP da bir IDR ve ondan **önce** gösterilen üç
B-kareyle başlıyor (POC −4, −6, −2). Konteynerin çözme ve sunma sırasından
ölçülen gerçek derinlik 2. FFmpeg'in H.264 çözücüsü, yani Chromium, Chrome ve
Edge'in yazılım yolu, bayrak açıkken SPS'teki sayıya güveniyor ve tamponu
büyütmüyor. Her B grubunda POC'si en küçük kare "sıra dışı" sayılıp atılıyor.

Kanıt: WebCodecs `VideoDecoder`'ı demux edilmiş paketlerle doğrudan süren
bağımsız bir test sayfası kullanıldı. İlk 200 paket girdi. Chromium, yazılım
çözmeli Chrome ve yazılım çözmeli Edge'de 150 kare çıktı: tam 50 kare (sunum
sırasında her 4. kare) düştü, hata bildirilmedi. Chrome'un donanım çözücüsü
200 kare verdi ama sunum sırasına dizmeden. `optimizeForLatency` ve
`prefer-software` sonucu değiştirmedi. mediabunny (1.58.1) Chromium'da her
çıkan kareye sıradaki en küçük girdi damgasını veriyor. Böylece her atılan
kare, sonraki bütün resimleri bir kare geriye kaydırdı. Damgalar kusursuz
göründü, resim gittikçe gecikti. Dosyanın tamamında ffmpeg karelerine göre
ölçülen kayma sona doğru 80 kareyi aştı.

Karar: dışa aktarmadan önce worker, H.264 izinin paket sırasını yalnızca
metadata ile tarıyor (baştan ve her kesimin başındaki anahtar kareden
240'ar paket). Bu tarama konteynerin gerçek yeniden sıralama derinliğini
ölçüyor (`avcReorder.ts`). Derinlik SPS'in bildirdiğinden büyükse avcC'deki
SPS'in yalnızca iki alanı (`max_num_reorder_frames`,
`max_dec_frame_buffering`) düzeltilip çözücüye veriliyor. Hiçbir şey yeniden
kodlanmıyor. Düzeltilmiş SPS ffmpeg ile doğrulandı: öteki bütün alanlar
aynı, yalnızca 1→2. Aynı test sayfasında düzeltmeyle üç yazılım yolu da
200/200 kare verdi, sıralı ve donanım çözücüsüyle birebir aynı içerikle.
Yan etki olarak donanım yolu da artık sıralı çıkıyor.

İki koruma:

- Derinlik, B deseni tekrarladığı için en az 3 karede görülmüş olmalı.
  Sentetik M06 (üç parçanın `concat` ile birleştirilmesi) birleşme yerinde tek
  bir bozuk damga taşıyor. İlk sürüm bunu 4 derinlik sanıp dosyayı reddetti.
  Bu yanlış pozitif matriste yakalandı ve düzeltildi.
- Paket içinde (in-band) SPS taşıyan akışta avcC düzeltmesi tutmuyor. Ölçüldü:
  FFmpeg her anahtar karede paketteki SPS'i yeniden okuyor ve kareler yine
  düşüyor. Düzeltme gerekip ilgili anahtar paketinde az bildiren bir SPS
  varsa dışa aktarma `source_reorder_unfixable` ile açıkça duruyor.

Maliyet: tarama 1–15 ms (GoPro 5 ms, 270 MiB'lık `.vid` 14 ms). Reorder
tamponu bir kare uzuyor. Dışa aktarma süresine ölçülebilir bir etkisi yok.

Sonuç: GoPro (R07) Chromium'da 0.969, Chrome ve Edge'de donanım ve yazılım
çözmede 0.974 (önce 0.947 / 0.804). Düzeltme diğer 7 gerçek H.264 kaydında
tetiklenmiyor. Onlarda SPS doğru.

Kalan sınırlar: taranan pencerelerin dışında derinleşen bir desen görülmez.
HEVC için benzer bir kontrol yok. mediabunny'nin damga yeniden atama
davranışı yüzünden, başka bir sebeple kare atan bir çözücü hâlâ damgalardan
tespit edilemez.

**Samsung S21 (sonradan eklenen `web-samsung-s21-h264-60fps-rot90.mp4`, R15)
bu sınıftan değil.** B-kare yok (derinlik 0), düzeltme devreye girmiyor.
Chromium'un çözdüğü 264 karenin 264'ü ffmpeg'in karesiyle aynı yerde.
Çıktı referansla kare kare hizalı: ±1 kare kaydırınca SSIM 0.825'ten 0.61'e
düşüyor. Düşük skor kodlamadan geliyor. Çok ayrıntılı 1080p60 bir kayıt bu.
x264 bile Chrome'un bit hızında (3.8 Mbit/s) referansa karşı yalnızca 0.856
alıyor. Chromium'un yazılım kodlayıcısı 0.825 veriyor, Chrome ve Edge 0.861.
Yani bu, eşik ve bit hızı konusu. Kare çözme hatası değil. (Kapandı, ADR-024:
sebep Chromium'un yazılım kodlayıcısı. Yazılım kodlayıcıya 3 kat bit hızıyla R15
Chromium'da 0.870 PASS; Chrome ve Edge dosyaları değişmedi.)

### 4. Koşucu kontrollü durdurmayı PASS sayıyordu (düzeltildi)

`run-real-media.mjs`, dışa aktarmanın açık bir hatayla durmasını geçerli bir
sonuç olarak PASS diye yazıyordu. Artık REFUSED. Doğru bir dürüst davranış,
ama çalışan bir dışa aktarma değil.

## Ara sonuç tablosu (ilk 8 gerçek kayıt)

| Tarayıcı | PASS | REFUSED | FAIL |
|---|---|---|---|
| Chrome | 8 | 0 | 0 |
| Edge | 8 | 0 | 0 |
| Chromium (Playwright) | 7 → **8** | 0 | 1 → **0** (R07 düzeltildi, §3) |
| Chrome / Edge, `--sw-decode` | 8 | 0 | 0 (R07 önce 0.804, şimdi 0.974) |

`run-real-media.mjs --sw-decode` Chromium ailesini GPU video çözücüsü olmadan
başlatıyor ve sonucu `real-media-<tarayıcı>-swdecode.json` olarak yazıyor.

## Son durum: 15 gerçek kayıt (birleştirilmiş main, 21 Eylül 2026)

| Tarayıcı | PASS | REFUSED | FAIL |
|---|---|---|---|
| Chrome | 13 | 2 (HDR: R09, R11) | 0 |
| Edge | 11 | 4 (HEVC içe aktarılamıyor: R13, R14; HDR: R09, R11) | 0 |
| Chrome `--sw-decode` | 11 | 4 (HEVC donanım çözücüsü ister; HDR) | 0 |
| Chromium (Playwright) | 10 | 4 | 1 (R15, SSIM 0.825; kodlama kalitesi, §3) |

- HEVC (Pixel 6 Pro 4K döndürmeli, Samsung slow-motion) yalnızca Chrome'da çalışıyor (SSIM 0.910 / 0.988). Edge ve Chromium bu makinede HEVC önizlemesini açamıyor ve bunu içe aktarmada açıkça söylüyor.
- HDR (HLG ve PQ) kayıtlar bilerek reddediliyor: tonlama olmadan SDR çıktı yanlış renk üretir (ADR-011).
- Döndürme (−90°, −180°) ve 60 fps kayıtlar doğru: iPhone 13 Pro 180° 0.957, Samsung S21 60 fps −90° Chrome 0.861.
- 5 dk 41 sn / 618 MiB iPhone 11 kaydı geçiyor (Chrome 0.945).

## Hâlâ sınanmayanlar

HDR kaydın Edge ve Chromium'da çıktısı (HEVC çözücüsü yok; aşağıdaki güncelleme), 618 MiB'tan büyük ya da 32 dakikadan uzun gerçek kaynak, Safari, fiziksel telefon tarayıcısı. R15'in Chromium'daki düşük skoru ADR-024 ile kapandı.

> Güncelleme 2026-09-23: HDR kayıtların SDR'ye tonlanarak dışa aktarılması ölçüldü ve açıldı (ADR-022). R09 ve R11 Chrome'da artık PASS; Edge ve Chromium'da HEVC çözücüsü olmadığı için içe aktarma reddi sürüyor.
