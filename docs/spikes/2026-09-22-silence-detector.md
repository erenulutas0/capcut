# Ölçüm — sessizlik kesim önerisi bulucusu (ADR-018 ölçüm kapısı)

> Tarih: 2026-09-22 · Bağlam: ADR-018 "Ölçüm kapısı" · Bütçe: 0 TL, tamamen yerel
> Sonuç: **Karar** bölümü. Sayıların hepsi `web/spike-results/silence-eval-2026-09-22-*.json`
> ham çıktılarındandır (`node scripts/silence-eval/summarize.mjs`); tahmin yoktur.
> **İnsan kulağıyla dinleme yapılmadı** (aşağıda "Hece kontrolü").

## Kısa sonuç

- `main` üzerindeki bulucu (9bc753d) kapıyı **geçmedi**: 98 önerinin **37'si konuşma kesti**
  (oda tonu, düşük ses, gürültü, müzik ve karışık dillerde; yalnızca dijital sessizlik temizdi),
  sınır sapması p95 **1009 ms**, müzikli dosyalarda **11** öneri.
- Tanı sonrası `web/src/domain/silence.ts`'de dört kural değişti (aşağıda). Aynı veri, aynı
  ölçümle **sonra**: kesilme **0**, bulma (a+b+c) **34/34 = %100**, sınır p95 **37 ms**,
  müzikte öneri **0**, negatiflerde öneri **0**.
- Bedeli: 15 dB ve 5 dB SNR gürültülü dosyalarla −12 dB müzikli dosyalarda artık **hiç öneri
  yok** ("güvenilir sessizlik yok" nedeniyle). ADR'nin güvenli hata yönü budur.
- Kapının "insan değerlendirmesi" satırı **açık**: 10 kesimin önce/sonra WAV çiftleri hazır,
  otomatik vekil temiz, ama kimse dinlemedi.

## Ne ölçüldü, ne ölçülmedi

| Ölçüm | Durum |
|---|---|
| Konuşma kesilmesi (örtüşme + ffmpeg seviye ölçümü) | ölçüldü, 31 dosya, 7 koşul |
| Bulma (eklenen boşluklar ≥ en kısa duraklama) | ölçüldü (a, b, c, f) |
| Sınır sapması p50/p95 | ölçüldü |
| Müzikte yanlış kesim | ölçüldü, **yalnızca sentetik müzikle** (2 tür) |
| Doğal (klip içi) duraklamalara öneri | sayıldı, uzunlukları raporda |
| Ayar taraması (3 × 3 × 3) | ölçüldü, önce ve sonra |
| Hece kontrolü (belge 31) | **insan dinlemesi YAPILMADI**; WAV çiftleri + otomatik enerji vekili var |
| Tarayıcının ürettiği zarf | ölçülmedi; burada zarfı ffmpeg üretti. Aynılık testi paralel iş (UI/worker dalı) |
| Gerçek müzik kaydı, gerçek oda kaydı, nefesli uzun duraklama, kurucunun sesi | **ölçülmedi** (hakları temiz, girişsiz kaynak bu oturumda yoktu / kullanıcı medyası yasak) |
| Çok konuşmacı, üst üste konuşma | ölçülmedi |
| AAC/MP4 gibi kayıplı kodlanmış kaynak | ölçülmedi (dosyalar 16-bit PCM WAV) |

## Ortam

Windows 11 Pro 10.0.26200, Node 20.18.0, ffmpeg 9.0.1 (gyan.dev full build). Sunucu ya da
tarayıcı yok; bulucu, uygulamanın kendi `src/domain/silence.ts` dosyası TypeScript ile
dönüştürülüp Node'da çağrılarak ölçüldü (kopya değil).

## Veri seti ve hakları

`web/tests/media/speech/silence-eval/SOURCES.md` (gitignore'lu; `node scripts/silence-eval/build-dataset.mjs` yeniden üretir).

- **Google FLEURS**, Hugging Face `google/fleurs`, revizyon `70bb2e84…`, girişsiz, **CC-BY-4.0**.
  Transkript denemesiyle (2026-09-21) aynı yol: test bölümü arşivlerinin yalnızca ilk
  **26 MB (tr_tr)** ve **16 MB (en_us)** HTTP Range ile alındı → 42 + 36 tam WAV. Havuz klasörü
  (`.pool/`) iki deneme arasında ortak.
- Klip seçimi: 4–14 s, cümle başına tek konuşmacı. 58 adaydan 40'ı kullanıldı (22 TR, 18 EN);
  18'i elendi: 13'ünde kaydın kendi gürültüsü konuşmaya 30 dB'den yakın (çoğu FLEURS'ün çok
  sessiz İngilizce kayıtları), 5'inde konuşma kaydın kenarına dayanıyor (kırpma payı yok).
- Değişiklikler (CC-BY gereği belirtilir): 16 → 48 kHz, konuşma aralığına kırpma (+10 ms), kırpma
  kenarında 5 ms yumuşatma, seviye eşitleme (konuşmanın 95. yüzdeliği −20 dBFS; kazanç −6.5 …
  +38.1 dB), boşluklarla birleştirme, sentetik yatak ekleme.
- **Yataklar ffmpeg ile üretildi** (üçüncü taraf hakkı yok): `anoisesrc` pembe / kahverengi /
  beyaz gürültü (sabit tohum); müzik A = her 2 s'de değişen üç sesli akor + 4 Hz tremolo;
  müzik B = her 0.5 s'de yeni nota çalan, ~26 dB sönen koparma arpej + hafif sürekli beşli.
- Kullanıcı medyası yok; `web/tests/media/real/` dokunulmadı; hiçbir dosya makineden çıkmadı.

### Dosyalar (31)

| Koşul | Dosya | Yatak | Dil |
|---|---|---|---|
| (a) dijital sessizlik | 6 | yok (boşluklar dijital sıfır) | 3 TR, 3 EN |
| (b) oda tonu | 6 | pembe/kahverengi, −60 / −55 / −50 dBFS, bütün dosyanın altında | TR/EN |
| (c) düşük ses | 4 | bütün dosya −20 dB (2'si oda tonlu: −55 / −50 dBFS, sonra −20) | TR/EN |
| (d) gürültü | 4 | pembe/beyaz, konuşma etkin RMS'ine göre 15 dB ve 5 dB SNR | TR/EN |
| (e) müzik | 4 | müzik A ve B, konuşmanın 12 dB ve 20 dB altında | TR/EN |
| (f) karışık | 3 | yok / pembe −55 / kahverengi −55 | TR↔EN dönüşümlü |
| negatif | 4 | 20 s dijital sessizlik; oda tonu −55; yalnız müzik A; yalnız müzik B | — |

Her konuşmalı dosya: 0.3 s giriş + 4–5 klip + aralarına eklenen 3–4 boşluk (0.3 / 0.5 / 0.8 /
1.2 / 2.0 / 3.0 s'den karışık, her dosyada farklı) + 1.0 s kuyruk. Toplam 1129 s ses, 94 eklenen
iç boşluk, kliplerin içinde 335 doğal duraklama (≥ 100 ms; 27'si ≥ 0.7 s).

## Yöntem

**Doğru cevap (temiz konuşma kanalından, 1 ms çözünürlük).** Her FLEURS klibinde 10 ms RMS,
1 ms adımla hesaplandı. "Konuşma penceresi": klibin 95. yüzdeliğinin 35 dB altından (ama kaydın
kendi gürültü tabanının en az 10 dB üstünden) yüksek; ayrıca bu pencerelerden oluşan dizinin
(20 ms'ye kadar çukurlar dahil) bir yerinde p95'e 20 dB'den yakın bir pencere olmalı. Böylece
yumuşak başlangıç ve sönümler konuşmaya dahil (kesilme sorusunda temkinli taraf), ama tek başına
duran düşük gürültü ve çoğu nefes konuşma sayılmaz. Klip ilk ve son konuşma penceresinin 10 ms
dışından kırpıldı. Doğru boşluk = bir klibin son konuşma penceresinden sonrakinin ilkine (eklenen
boşluk + 2 × 10 ms). Klip içinde ≥ 100 ms konuşmasız aralıklar "doğal duraklama"; konuşma
bölütleri bunların dışında kalanlar.

İlk sürümde konuşma tanımı yalnız eşikti; FLEURS'ün sessiz kayıtları +30 dB yükseltilince
kayıt gürültüsündeki tek tük tepecikler "konuşma" sayıldı ve bulucunun doğru davranışı kesilme
göründü. Tanım yukarıdaki "yüksek pencereye bağlı dizi" kuralıyla düzeltildi; aşağıdaki **önce**
sayıları da bu düzeltilmiş doğru cevapla alındı.

**Bulucunun girdisi (bağımsız ölçüm).** Karışımın zarfını ffmpeg üretti:
`aresample=48000,aformat=channel_layouts=mono,asetnsamples=n=480:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`
(10 ms kare, −inf → −120 dB). Bütün dosya tek bir "an" olarak `findSilences`'a verildi.

**Konuşma kesilmesi.** Her öneri için, konuşma kanalının (yataksız) ffmpeg ile ölçülen **5 ms**
RMS kareleri (bulucunun 10 ms karelerinden farklı çerçeve) içinde en yüksek değer, dosyanın
konuşma seviyesiyle (konuşma bölütlerindeki 5 ms karelerin 95. yüzdeliği) karşılaştırıldı.
**Vaka** = öneri konuşma bölütleriyle > 20 ms örtüşüyor **veya** içinde konuşma seviyesine 20 dB'den
yakın bir 5 ms kare var. Yatak gürültüsü seviye kuralını tetiklemesin diye konuşma kanalı
kullanıldı; karışımın kendisiyle aynı ölçüm de ayrıca verildi ("karışım" sütunu).

**Bulma.** Eklenen iç boşluklardan en kısa duraklamaya (varsayılan 0.7 s) eşit ya da uzun
olanların bir öneriyle örtüşme oranı. Kapı (a) temiz ve (b) oda tonu için %90 ister; (c) de eklendi.

**Sınır.** Bulunan her boşlukta, öneri kenarının (boşluk kenarı ± pay) konumundan farkı (ms);
kuyrukta yalnız baş kenar.

**Müzik.** (e) dosyalarında ve iki yalnız-müzik negatifinde **her öneri** yanlış kesim sayıldı
(müziği atlatır; öneri yokluğu kabul).

## Sonuçlar

#### Önce (main 9bc753d, `silence.ts` değişmeden)

| Koşul | Dosya | Öneri yok (neden) | Öneri | Konuşma kesilmesi (stem / karışım) | Bulma (≥ min.) | Kısa boşluk önerildi | Kuyruk | Sınır sapması p50 / p95 / en çok (ms) | Doğal duraklama kesimi |
|---|---|---|---|---|---|---|---|---|---|
| (a) dijital sessizlik | 6 | 0 | 18 | **0** / 0 | 11/11 (100%) | 0/10 | 6/6 | 8 / 15 / 162 | 1 |
| (b) oda tonu | 6 | 0 | 26 | **13** / 13 | 13/13 (100%) | 5/8 | 6/6 | 37 / 1105 / 1454 | 1 |
| (c) düşük ses (−20 dB) | 4 | 0 | 17 | **6** / 6 | 10/10 (100%) | 2/4 | 4/4 | 11 / 1009 / 1451 | 1 |
| (d) gürültü 15 / 5 dB SNR | 4 | 1 | 13 | **11** / 13 | 5/9 (56%) | 1/5 | 2/4 | 171 / 1198 / 1549 | 4 |
| (e) müzik −12 / −20 dB | 4 | 0 | 11 | **3** / 11 | 5/9 (56%) | 2/5 | 2/4 | 74 / 549 / 1458 | 2 |
| (f) TR/EN karışık | 3 | 0 | 13 | **4** / 4 | 9/9 (100%) | 1/1 | 3/3 | 10 / 855 / 1178 | 0 |
| negatif (konuşmasız) | 4 | 2 | 0 | **0** / 0 | — | — | — | — / — / — | 0 |
| **Toplam** | 31 | 3 | 98 | **37** / 47 | a+b+c: 34/34 (100%) | 11/33 | 23/27 | a+b+c: 11 / **1009** / 1454; hepsi: 1105 | 9 |

Müzikli dosyalarda (e + müzik negatifleri) öneri: **11**. Negatif dosyalarda öneri: **0**.

#### Sonra (bu dal)

| Koşul | Dosya | Öneri yok (neden) | Öneri | Konuşma kesilmesi (stem / karışım) | Bulma (≥ min.) | Kısa boşluk önerildi | Kuyruk | Sınır sapması p50 / p95 / en çok (ms) | Doğal duraklama kesimi |
|---|---|---|---|---|---|---|---|---|---|
| (a) dijital sessizlik | 6 | 0 | 18 | **0** / 0 | 11/11 (100%) | 0/10 | 6/6 | 8 / 14 / 15 | 1 |
| (b) oda tonu | 6 | 0 | 23 | **0** / 0 | 13/13 (100%) | 1/8 | 6/6 | 7 / 45 / 166 | 3 |
| (c) düşük ses (−20 dB) | 4 | 0 | 16 | **0** / 0 | 10/10 (100%) | 0/4 | 4/4 | 7 / 25 / 36 | 2 |
| (d) gürültü 15 / 5 dB SNR | 4 | 4 | 0 | **0** / 0 | 0/9 (0%) | 0/5 | 0/4 | — / — / — | 0 |
| (e) müzik −12 / −20 dB | 4 | 3 | 0 | **0** / 0 | 0/9 (0%) | 0/5 | 0/4 | — / — / — | 0 |
| (f) TR/EN karışık | 3 | 0 | 13 | **0** / 0 | 9/9 (100%) | 0/1 | 3/3 | 4 / 10 / 48 | 1 |
| negatif (konuşmasız) | 4 | 4 | 0 | **0** / 0 | — | — | — | — / — / — | 0 |
| **Toplam** | 31 | 11 | 70 | **0** / 0 | a+b+c: 34/34 (100%) | 1/33 | 19/27 | a+b+c: 7 / **37** / 166; hepsi: 37 | 7 |

Müzikli dosyalarda (e + müzik negatifleri) öneri: **0**. Negatif dosyalarda öneri: **0**.
(e-music-04, müzik B −20 dB: analiz "öneri var" dedi ama hiçbir duraklama kuralları geçmedi → 0 öneri.)

#### Boşluk uzunluğuna göre bulma (sonra, a+b+c+f)

| Eklenen boşluk (s) | 0.3 | 0.5 | 0.8 | 1.2 | 2.0 | 3.0 |
|---|---|---|---|---|---|---|
| önerildi / var | 0/10 | 1/13 | 11/11 | 10/10 | 12/12 | 10/10 |

0.5 s'lik tek öneri (b-room): boşluğun iki yanındaki eşik altı sönümlerle duraklama 0.7 s'yi
geçti; konuşma kesilmedi. Hata sayılmaz, bilgi olarak yazıldı.

## Tanı: önceki bulucu neden kesiyordu

Önceki 37 vakanın 23'ü iki kuralı birden, 9'u yalnız seviye kuralını (kesim içinde konuşmaya
20 dB'den yakın 5 ms kare), 5'i yalnız örtüşme kuralını (> 20 ms) çiğnedi. Yere göre: 24 eklenen
boşluk, 6 doğal duraklama, 5 kuyruk, 2 giriş. Ham listeler JSON'da; nedenler:

1. **Kısa ses kuralı (60 ms'den kısa ses duraklamayı bölmez) sesin gücüne bakmıyordu.** Klip
   sonundaki bir tık ya da patlamalı ünsüz (b-room-03: konuşmanın 7 dB altında, 30 ms), sözcük
   başındaki dudak sesi + nefes (b-room-04: −14 dB) "tık" sayılıp köprülendi ve duraklama
   konuşmanın içine uzadı. Tek başına bu düzeltme vakaları 37 → 6'ya, sınır p95'i 1009 → 45 ms'ye
   indirdi (ara adımlar tablosu).
2. **Eşik konuşmaya 12 dB'ye kadar yaklaşabiliyordu.** 15 dB SNR gürültüde eşik konuşmanın
   ~14 dB altına oturdu; gürültünün içinde kalan yumuşak hece sonları "sessiz" sayıldı
   (d-noisy-02: 9 öneri, 9 vaka).
3. **Müziğin altındaki duraklama "sessiz" görünüyordu.** Müzik konuşmanın 20 dB altındayken
   sessiz/yüksek farkı 27 dB; 12 dB'lik "düşük kontrast" kuralı devreye girmedi.
4. Payın (150 ms) kendisi sorun değildi: dijital sessizlikte sınır p95 15 ms, vaka 0.

## Değişiklikler (`web/src/domain/silence.ts`)

Her biri tek tek ölçüldü; yalnızca başarısız ölçütü iyileştirip diğerlerini bozmayanlar kaldı.

| # | Kural | Önce | Sonra | Gerekçe (ölçüm) |
|---|---|---|---|---|
| 1 | Kısa ses köprüsü | 60 ms'den kısa her ses | 60 ms'den kısa **ve konuşmanın 25 dB altında kalan** ses | 20 dB ile 37 → 6 vaka; kalan c-low-04 kuyruk vakası 5 ms tepesi −19.4 dB olan bir sönümdü (10 ms RMS'ten 2–3 dB yüksek) → 25 dB ile 0, bulma değişmedi, sınır p95 45 → 37 ms |
| 2 | Eşiğin konuşmaya en yakın yeri | konuşmanın 12 dB altı; duyarlılık bunu da kaydırabiliyordu | **20 dB altı, duyarlılık sonrası da** | gürültüde 10 öneri / 5 vaka → 0 / 0; kapının kendi "20 dB" kuralıyla aynı çizgi. Duyarlılık + yönde artık bu sınırı aşamaz |
| 3 | "Güvenilir sessizlik yok" (`low_contrast`) | sessiz–yüksek farkı < 12 dB | **< 26 dB** (6 dB taban payı + 20 dB konuşma payı ancak 26 dB'de sığar) | 2. kuralın doğal sonucu; gürültülü dosyalar "öneri 0" yerine nedeniyle reddedilir. a/b/c/f'de fark ≥ 30 dB, etkisiz |
| 4 | Dalgalanan duraklama | yok | önerilecek bir aralığın (dijital sıfır kareleri hariç) 90. ve 10. yüzdelikleri arası **> 10 dB** ise **bütün an** `low_contrast` | Müzik A −20 dB: 2 → 0 öneri. Ölçülen yayılım: gürültü/oda tonu boşlukları 3.3–5.5 dB, müzik 12.7–15.1 dB. Önce yalnız o duraklamayı atlamak denendi: müzikte 1 öneri kaldı (bir doğal duraklama, yayılım ~9 dB); 8 dB eşik de onu yakalamadı. "Bir duraklamanın altında yatak varsa hepsinin altında vardır" kuralı 0 verdi; yataksız ya da oda tonlu 19 konuşmalı dosyanın (a, b, c, f) hiçbirini reddetmedi |

API değişmedi: `SilenceAnalysis` nedenleri yine `'too_short' | 'low_contrast'`. `low_contrast`
artık "fark az **ya da** sessiz yerler müzik gibi dalgalanıyor" demektir; arayüz metni "sürekli
müzik ya da gürültü" diyorsa doğru kalır. Birim testleri: tık testi ikiye ayrıldı (sessiz tık
köprülenir, konuşma seviyesindeki bölmez), 3 yeni test (eşik duyarlılıktan sonra da konuşmanın
20 dB altında; 26 dB altı fark `low_contrast`; tremolo duraklaması `low_contrast`, dijital
sıfırlı oda tonu değil).

#### Ara adımlar (aynı veri, aynı ölçüm; varsayılan ayarlar)

| Adım | Kesilme (stem / karışım) | Bulma a+b+c | Sınır p95 a+b+c (ms) | Müzikte öneri | Gürültüde öneri | Doğal duraklama kesimi |
|---|---|---|---|---|---|---|
| önce (9bc753d) | 37 / 47 | 34/34 | 1009 | 11 | 13 | 9 |
| + kısa ses ≥ 20 dB altı | 6 / 16 | 34/34 | 45 | 5 | 10 | 15 |
| + eşik konuşmanın 20 dB altı | 1 / 3 | 34/34 | 45 | 2 | 0 | 13 |
| + düşük kontrast 26 dB | 1 / 3 | 34/34 | 45 | 2 | 0 | 13 |
| + dalgalanan duraklama atlanır (10 dB) | 1 / 2 | 34/34 | 45 | 1 | 0 | 12 |
| + kısa ses 25 dB altı | 0 / 1 | 34/34 | 37 | 1 | 0 | 8 |
| (denendi, bırakıldı) dalgalanma 8 dB | 0 / 1 | 34/34 | 37 | 1 | 0 | 7 |
| + dalgalanan duraklama → bütün an reddedilir | 0 / 0 | 34/34 | 37 | 0 | 0 | 7 |
| + duyarlılık da 20 dB sınırına tabi (**son**) | 0 / 0 | 34/34 | 37 | 0 | 0 | 7 |

(Ara adımların JSON'ları `web/spike-results/silence-eval-2026-09-22-{fixA,fixAB1,fixAB2,fixABC,fixABC25,spread8,fileSteady}.json`.)

## Ayar taraması

#### Sonra

| En kısa (s) | Pay (ms) | Duyarlılık (dB) | Kesilme | Bulma a+b+c | Sınır p95 a+b+c (ms) | Müzikte öneri | Gürültüde öneri | Doğal duraklama kesimi | Önerilen toplam (s) |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 100 | -5 | 0 | 45/47 (96%) | 20 | 0 | 0 | 3 | 88.8 |
| 0.5 | 100 | 0 | **1** | 46/47 (98%) | 36 | 0 | 0 | 9 | 95.8 |
| 0.5 | 100 | +5 | **7** | 47/47 (100%) | 69 | 0 | 0 | 14 | 96.5 |
| 0.5 | 150 | -5 | 0 | 45/47 (96%) | 20 | 0 | 0 | 3 | 82.0 |
| 0.5 | 150 | 0 | 0 | 46/47 (98%) | 36 | 0 | 0 | 9 | 88.4 |
| 0.5 | 150 | +5 | **1** | 45/47 (96%) | 65 | 0 | 0 | 17 | 91.4 |
| 0.5 | 250 | -5 | 0 | 34/47 (72%) | 20 | 0 | 0 | 3 | 68.3 |
| 0.5 | 250 | 0 | 0 | 35/47 (74%) | 37 | 0 | 0 | 7 | 73.5 |
| 0.5 | 250 | +5 | **1** | 35/47 (74%) | 83 | 0 | 0 | 10 | 76.4 |
| 0.7 | 100 | -5 | 0 | 34/34 (100%) | 20 | 0 | 0 | 3 | 85.3 |
| 0.7 | 100 | 0 | **1** | 34/34 (100%) | 37 | 0 | 0 | 7 | 91.7 |
| 0.7 | 100 | +5 | **5** | 34/34 (100%) | 83 | 0 | 0 | 9 | 90.3 |
| 0.7 | 150 | -5 | 0 | 34/34 (100%) | 20 | 0 | 0 | 3 | 79.7 |
| **0.7** | **150** | **0** | 0 | 34/34 (100%) | 37 | 0 | 0 | 7 | 85.6 |
| 0.7 | 150 | +5 | **2** | 34/34 (100%) | 83 | 0 | 0 | 10 | 89.1 |
| 0.7 | 250 | -5 | 0 | 34/34 (100%) | 20 | 0 | 0 | 3 | 68.3 |
| 0.7 | 250 | 0 | 0 | 34/34 (100%) | 37 | 0 | 0 | 7 | 73.5 |
| 0.7 | 250 | +5 | **1** | 34/34 (100%) | 83 | 0 | 0 | 10 | 76.4 |
| 1 | 100 | -5 | 0 | 25/26 (96%) | 20 | 0 | 0 | 2 | 73.0 |
| 1 | 100 | 0 | 0 | 26/26 (100%) | 37 | 0 | 0 | 6 | 82.8 |
| 1 | 100 | +5 | **4** | 26/26 (100%) | 83 | 0 | 0 | 7 | 85.9 |
| 1 | 150 | -5 | 0 | 25/26 (96%) | 20 | 0 | 0 | 2 | 68.9 |
| 1 | 150 | 0 | 0 | 26/26 (100%) | 37 | 0 | 0 | 6 | 78.1 |
| 1 | 150 | +5 | **1** | 26/26 (100%) | 83 | 0 | 0 | 7 | 81.1 |
| 1 | 250 | -5 | 0 | 25/26 (96%) | 20 | 0 | 0 | 2 | 60.7 |
| 1 | 250 | 0 | 0 | 26/26 (100%) | 37 | 0 | 0 | 6 | 68.7 |
| 1 | 250 | +5 | **1** | 26/26 (100%) | 83 | 0 | 0 | 7 | 71.4 |

Okuma:
- **Duyarlılık +5 hiçbir satırda güvenli değil** (1–7 vaka, sınır p95 65–83 ms). −5 her satırda
  0 vaka ve en iyi sınır (20 ms); bedeli 0.5 ve 1.0 s'de birer kaçan boşluk ve daha az doğal
  duraklama önerisi.
- **Pay 100 ms** 0.5 ve 0.7 s'de 1 vaka verdi (yumuşak sönüm pay + 20 ms'den uzun). 150 ms ve
  üstü, duyarlılık ≤ 0 iken 0 vaka.
- **Pay 250 ms + en kısa 0.5 s** bulmayı %72–74'e düşürür (0.5 s boşluk iki payla 200 ms'nin
  altında kalır). Diğer satırlarda bulma ≥ %96.
- Müzik ve gürültüde her satırda 0 öneri: bu iki durum ayar kaydırılarak açılmıyor.
- Öneri: varsayılan (0.7 s / 150 ms / 0) kalsın. Arayüz duyarlılığı + yönde sunuyorsa, bu
  ölçümle **+ yönün konuşma kesebildiği** kullanıcıya söylenmeli ya da kaydırıcı 0'da
  kesilmeli (arayüz dalının kararı; bu dal arayüze dokunmadı).

#### Önce (karşılaştırma, yalnız 0.7 s satırları; tamamı JSON'da)

| En kısa (s) | Pay (ms) | Duyarlılık (dB) | Kesilme | Bulma a+b+c | Sınır p95 a+b+c (ms) | Müzikte öneri | Gürültüde öneri |
|---|---|---|---|---|---|---|---|
| 0.7 | 100 | -5 / 0 / +5 | 22 / 43 / 78 | 34/34 hepsinde | 567 / 1009 / 1019 | 0 / 11 / 22 | 9 / 13 / 22 |
| 0.7 | 150 | -5 / 0 / +5 | 18 / **37** / 70 | 34/34 hepsinde | 567 / 1009 / 1019 | 0 / 11 / 22 | 9 / 13 / 22 |
| 0.7 | 250 | -5 / 0 / +5 | 18 / 30 / 54 | 34/34 hepsinde | 567 / 1009 / 1019 | 0 / 11 / 22 | 9 / 13 / 22 |

Önceki bulucu **hiçbir** ayarda 0 vakaya inmiyordu (en iyisi 15); sorun ayarda değil kuraldaydı.

## Doğal (klip içi) duraklamalara öneri

Varsayılan ayarla 7 öneri (önce 9). Hata sayılmadı; hepsi konuşmanın en az 23 dB altında.

| Dosya | Kesim (ms) | Kesim uzunluğu (ms) | Doğal duraklama uzunluğu (ms) | Kesimdeki en yüksek konuşma seviyesi (dB, konuşmaya göre) |
|---|---|---|---|---|
| a-digital-05 | 29550–30120 | 570 | 1074 | -32.4 |
| b-room-02 | 22680–23780 | 1100 | 1294 | -23.8 |
| b-room-05 | 16820–17530 | 710 | 984 | -29.4 |
| b-room-06 | 18120–18910 | 790 | 1074 | -32.2 |
| c-low-02 | 23160–24090 | 930 | 1245 | -27.0 |
| c-low-04 | 4120–5230 | 1110 | 1294 | -23.3 |
| f-mixed-02 | 19840–20640 | 800 | 1074 | -32.3 |

İkisinde (−23.8, −23.3 dB) kapı sınırına 3–4 dB kalıyor: bu duraklamalarda nefes ya da çok
yumuşak ses var. İnsan dinlemesinde öncelikle bunlara bakılmalı.

## Hece kontrolü (belge 31) — dinleme yerine

**Kimse dinlemedi; ben de dinlemedim.** Yapılan: varsayılan ayarla sonuçtan tohum 42 ile rastgele
10 kesim seçildi; her biri için kesimin 1.5 s öncesi–sonrası **özgün** ve **kesim uygulanmış**
WAV çifti `web/spike-results/silence-listen/after/` altına yazıldı (önceki bulucu için
`…/before/`). Otomatik vekil: kesim kenarlarının iki yanında 50 ms'lik enerji ve kalan tarafta
kesime doğru eğim.

| # | Dosya | Tür | Kesim (ms) | Kalan önce: en yüksek / eğim | Atılan baş en yüksek | Atılan son en yüksek | Kalan sonra: en yüksek / eğim | İşaret |
|---|---|---|---|---|---|---|---|---|
| 1 | c-low-01 | iç boşluk | 21160–23860 | -81 / 0.0 | -81 | -81 | -81 / 0.0 | yok |
| 2 | b-room-05 | iç boşluk | 8400–9380 | -29 / -2.6 | -29 | -30 | -29 / -4.1 | yok |
| 3 | f-mixed-01 | iç boşluk | 26160–27870 | -101 / 0.0 | -101 | -101 | -101 / 0.0 | yok |
| 4 | c-low-02 | iç boşluk | 30620–32330 | -32 / -5.3 | -34 | -33 | -32 / 0.6 | yok |
| 5 | a-digital-05 | doğal | 29550–30120 | -35 / -8.8 | -36 | -36 | -34 / -0.7 | yok |
| 6 | b-room-06 | iç boşluk | 9030–9550 | -39 / 1.1 | -39 | -40 | -38 / -0.6 | yok |
| 7 | b-room-01 | iç boşluk | 24210–24610 | -28 / -3.6 | -33 | -35 | -34 / -1.9 | yok |
| 8 | c-low-01 | kuyruk | 29310–30160 | -81 / 0.0 | -81 | -81 | — | yok |
| 9 | f-mixed-01 | kuyruk | 36750–37600 | -101 / 0.0 | -101 | -101 | — | yok |
| 10 | b-room-05 | iç boşluk | 17840–18390 | -31 / 0.4 | -31 | -30 | -29 / 1.5 | yok |

Seviyeler 10 ms RMS, dosyanın konuşma seviyesine göre dB. İşaret kuralları: kesimin içindeki ilk
ya da son 50 ms'de konuşmaya 20 dB'den yakın ses; ya da kalan 50 ms içinde kesime doğru > 10 dB
yükselen ve −30 dB'yi aşan enerji. Hiçbiri tetiklenmedi. Oda tonlu kesimlerde −28…−40 dB değerleri
oda tonunun kendisidir. **Vekilin zayıflığı:** 10 kesimin 4'ü dijital sessizlikte (ek yeri kusursuz
olmak zorunda) ve 150 ms pay yüzünden kenarın 50 ms'si her zaman duraklamanın içindedir; bu tablo
"kenarda hece yok"u gösterir, "kesilmiş hali doğal duyuluyor"u göstermez. **Kapının bu satırı için
bir insanın bu 10 çifti (ve yukarıdaki iki doğal duraklamayı) dinleyip sonucu yazması gerekir.**

## Kapı, satır satır (varsayılan ayar, sonra)

| Kapı satırı (ADR-018) | Eşik | Önce | Sonra | Durum |
|---|---|---|---|---|
| Kaynak: hakları temiz, doğru cevabı bilinen | FLEURS CC-BY-4.0, bilinen boşluklar | — | 40 FLEURS klibi, 94 eklenen boşluk, sentetik yataklar | **tamam** |
| Koşullar: temiz, oda tonu, düşük ses, gürültü, müzik; TR+EN; ≥ 20 dosya | | — | 31 dosya, 7 koşul, TR/EN/karışık | **tamam** (müzik yalnız sentetik) |
| Konuşma kesilmesi | 0 vaka | 37 | **0** (karışımla ölçülünce de 0) | **GEÇTİ** |
| Bulma (temiz + oda tonu) | ≥ %90 | %100 | **%100** (a 11/11, b 13/13; c 10/10) | **GEÇTİ** |
| Sınır doğruluğu | p95 ≤ 50 ms | 1009 ms | **37 ms** (en çok 166 ms) | **GEÇTİ** |
| Müzik | yanlış kesim 0 | 11 | **0** | **GEÇTİ** (yalnız sentetik müzikle) |
| İnsan değerlendirmesi (hece) | küçük örneklemde yapılıp yazılır | — | WAV çiftleri + otomatik vekil; **dinleme yok** | **AÇIK** |

## Karar

1. **Ölçülebilen beş kapı satırı, bu daldaki bulucuyla geçiyor; önceki bulucu (9bc753d) üçünde
   kalıyordu.** Değişiklik olmadan özellik ana akışa girmemeliydi.
2. **Özellik henüz ana akışa girmez:** kapının insan dinlemesi satırı açık. Tek sonraki adım:
   kurucu (ya da bir kişi) `web/spike-results/silence-listen/after/` altındaki 10 çifti ve
   b-room-02 / c-low-04 doğal duraklama kesimlerini dinler, "hece kesildi mi / doğal mı" diye
   yazar. Bu olumluysa ve arayüz dalındaki tarayıcı zarfı ffmpeg zarfıyla aynılık testini
   geçerse kapı kapanır.
3. Bilerek kabul edilen bedel: konuşmanın 26 dB'den az altında gürültü ya da ritmi/dalgalanması
   olan müzik varsa **hiç öneri yok** (bu sette 8 dosya). ADR'nin "kaçan duraklama bir saniye,
   yanlış kesim bir hece" ilkesi.
4. Arayüz için not: duyarlılık + yönde ölçülen her ayarda konuşma kesti (1–7 vaka); duyarlılık
   kaydırıcısının + yarısı ya kaldırılmalı ya da uyarıyla sunulmalı.

## Sınırlar (ne bilinmiyor)

- **Müzik yalnızca sentetik.** Tremolo'lu akor ve sönen arpej, dalgalanma kuralını (10 dB)
  kolayca tetikler. Uzun, düz bir pad/yaylı yatak (10 ms RMS'i 3–6 dB dalgalanan) konuşmanın 26 dB'den
  fazla altındaysa bu kural onu **yakalamaz**; o zaman müziğin altındaki duraklama önerilir
  (konuşma kesilmez, müzik atlar). Gerçek, hakları temiz müzikle ölçülmedi.
- **Gerçek duraklamalarda nefes.** Eklenen boşluklar temiz; gerçek konuşmada uzun duraklamalar
  sık sık nefes içerir. Nefesli bir duraklama dalgalanma kuralına takılırsa **bütün an** öneri
  almaz. Bu sette a, b, c, f koşullarındaki 19 konuşmalı dosyanın hiçbiri buna takılmadı (FLEURS klipleri içindeki doğal
  duraklamalar dahil), ama gerçek vlog sesiyle ölçülmedi; kaçan öneri oranı bilinmiyor.
- Doğru cevaptaki "konuşma" tanımı enerji tabanlıdır (1 ms, temiz kanal); fonetik etiket
  değildir. Tek başına duran, konuşmanın 20 dB'den fazla altındaki sesler konuşma sayılmadı.
- FLEURS'ün sessiz kayıtları +30…+38 dB yükseltildi; bunların kayıt gürültüsü de yükseldi
  (konuşmanın ~30 dB altı). Bu, gerçek telefon kaydına benzer ama aynısı değildir.
- Zarf ffmpeg'den; tarayıcı worker'ının zarfı burada ölçülmedi (paralel dalın aynılık testi).
- 48 kHz PCM; AAC/Opus kodlanmış kaynak, stereo'da faz farkı, çok konuşmacı ölçülmedi.
- 31 dosyalık küçük bir set; ADR'nin dediği gibi sertifika değil, erken hata yakalama.

## Yeniden üretme

```
cd web
npm ci
node scripts/silence-eval/build-dataset.mjs     # FLEURS'ten 42 MB (Range), 31 dosya → tests/media/speech/silence-eval/
git show 9bc753d:web/src/domain/silence.ts > spike-results/silence.9bc753d.ts
node scripts/silence-eval/evaluate.mjs --tag=before --detector=spike-results/silence.9bc753d.ts
node scripts/silence-eval/evaluate.mjs --tag=after
node scripts/silence-eval/summarize.mjs --before=before --after=after
```
