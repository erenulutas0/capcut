# 03 — Maliyetler ve kullanım politikası önerisi

> 20 Eylül 2026 · USD · Standart ilan edilen API birim fiyatları. Vergi, bölge farkı, anlaşmalı indirim, yardımcı iş ve bizim altyapımız hariçtir. Bunlar gerçek faturamız veya kalite kıyaslaması değildir.

## Konuşmayı yazıya çevirme

| API / model | Ses dakikası | 10 dakika | 1.000 dakika | Not |
|---|---:|---:|---:|---|
| OpenAI gpt-4o-mini-transcribe | yaklaşık 0,003 USD | 0,03 USD | 3 USD | Sağlayıcının tahmini dakika karşılığı; kelime zamanlarını varsayma. |
| OpenAI gpt-transcribe | 0,0045 USD | 0,045 USD | 4,50 USD | Metin dökümü adayı; zamanlama için ayrıca capability kontrolü. |
| OpenAI gpt-4o-transcribe | yaklaşık 0,006 USD | 0,06 USD | 6 USD | Sağlayıcının tahmini dakika karşılığı. |
| ElevenLabs Scribe v2 | 0,22 USD/saat ≈ 0,003667 USD/dakika | ≈ 0,0367 USD | ≈ 3,67 USD | Ek entity/keyterm özellikleri temel fiyata dahil varsayılmaz. |

OpenAI fiyatları [S08], Scribe fiyatı [S09P]. Son hesapta dakika başına yuvarlanmış Scribe sayısını değil 0,22/60 oranını kullan. Fiyat tablosu çıktı formatı ve doğruluğun aynı olduğunu göstermez.

## Çeviri ayrı hesaplanır

Google Cloud Translation standart NMT için ücretsiz kredi sonrasındaki referans: **1 milyon kaynak karakter için 20 USD**, hedef dil başına. Ücretsiz sağlayıcı kredisini kalıcı marj kaynağı saymıyoruz. Farklı model ve taahhüt fiyatları farklıdır. [S15]

Yalnızca örnek varsayım: konuşma dakikası başına 900 faturalandırılan karakter. Gerçekte dil, konuşma hızı, noktalama ve boşluklar değiştirir.

- 10 dakikalık döküm: 9.000 karakter.
- Bir hedef dile çeviri: 9.000 × 20 / 1.000.000 = **0,18 USD**.
- Scribe ile 10 dakika ASR + bir hedef dil: 0,036667 + 0,18 = **yaklaşık 0,2167 USD**.
- Aynı işten 1.000 tane: **yaklaşık 216,67 USD**, render ve diğer giderlerden önce.

Üç hedef dil için ses yeniden yazıya çevrilmez; aynı onaylı kaynak metin üç kez çevrilir. Çeviri ücretinin ses dökümünden daha büyük olabilmesi mümkündür. Daha ucuz metin modeli adayları ayrı kalite/maliyet testinden sonra seçilebilir; burada fiyat uydurulmamıştır.

## Diğer AI işlemleri aynı birim maliyette değildir

ElevenLabs sayfasındaki Voice Isolator örneği 0,12 USD/dakikadır. Dubbing v1 için detaylı tabloda filigranlı çıktı 0,33 USD/dakika, filigransız çıktı 0,50 USD/dakikadır; başlıktaki 0,33 USD fiyatını filigransız ürün maliyeti sanma. Dubbing v2 2,20 USD/dakikadır. 10 dakikalık iş, ses temizlemede 1,20 USD; v1 filigranlı dublajda 3,30 USD; v1 filigransız dublajda 5 USD; v2 dublajda 22 USD eder. Bunlar farklı ürün ve çıktı kaliteleridir; birbirinin eşdeğeri değildir. [S09P]

Bu yüzden “120 dakika AI” deyip transkript, ses temizleme ve dublajı aynı havuzdan tüketme. Kullanıcıya az sayıda anlaşılır birim göster; arkada işlemlerin maliyet kayıtları ayrı olsun.

## Free / Pro revizyon adayı

Bu tablo **kanonik plan değildir**. Eski fiyat/kota belgesindeki AI hariç politikasını ancak açık karar ve maliyet kapısından sonra değiştirir.

| Yetenek | Free önerisi | Pro önerisi |
|---|---|---|
| Elle altyazı, SRT/VTT içe aktarma, düzeltme | Dahil | Dahil |
| Oluşturulmuş metni TXT/SRT/VTT olarak alma | Dahil | Dahil |
| Yerel altyazılı MP4 | Motor destekliyorsa mevcut platform limitleri içinde | Aynı platform sınırları |
| Otomatik ASR | Doğrulanmış hesap başına toplam 10 dakika, bir defalık | Aylık 120 dakika |
| Altyazı çevirisi | Bir defalık 2 dil-dakika | Aylık 30 dil-dakika |
| Oluşturulmuş altyazının stilini değiştirme | Yeni ASR kotası tüketmez | Yeni ASR kotası tüketmez |
| Kayıtlı marka/stil ve sıralı çoklu çıktı | Temel hazır stiller | Tekrar kullanım değeri adayı |
| Bulut video render | Mevcut 15 numaralı belgede ayrı hak | Mevcut 30 dakika/ay önerisi ayrı; AI dakikasıyla birleşmez |
| Dublaj / premium AI ses temizleme | Dahil değil | Başlangıçta dahil değil |

**Dil-dakika:** 5 dakikalık klibi iki hedef dile çevirmek 10 dil-dakikadır. ASR yalnızca ilk kaynak ses işlemesinde hesaplanır. İçerik kaydı silindikten sonra tekrar üretim yeni ücretli işlem gerektirebilir; bunu silme öncesinde açıkla.

Temel yerel işlem için hesap gerekmez. Ücretsiz bulut denemesinde hesap doğrulama, süre/boyut kontrolü, global harcama tavanı ve hız sınırı önerilir. Ücretsiz haklar aylık tekrar verilmez. Deneme için kart zorunluluğu yoktur.

Mevcut **6,99 USD/ay ve 49,99 USD/yıl** başlangıç fiyat hipotezi hemen değiştirilmez. Yeni paketin değeri ve marjı ölçülür. Yıllık haklar 12 ay peşin dağıtılmaz; aylık yenilenir. Her yeni para/kota kararı `docs/15_PRICING_FREE_PRO.md` içinde tek kaynağa taşınmalıdır.

## Pro tam kullanım örneği — kâr hesabı değildir

Baz senaryo: 120 dakika Scribe + 30 dil-dakika çeviri; 900 karakter/dakika.

```text
ASR = 120 × 0,22 / 60 = 0,44 USD
Çeviri = 30 × 900 × 20 / 1.000.000 = 0,54 USD
Toplam = 0,98 USD
Her iki maliyete %25 örnek retry payı eklenirse = 1,225 USD
```

Yüksek metin yoğunluğu senaryosu: ASR maliyet varsayımı 0,006 USD/dakika, 2.000 karakter/dakika.

```text
ASR = 120 × 0,006 = 0,72 USD
Çeviri = 30 × 2.000 × 20 / 1.000.000 = 1,20 USD
Toplam = 1,92 USD
%25 örnek retry payıyla = 2,40 USD
```

Yıllık 49,99 USD’nin aylık brüt karşılığı yaklaşık 4,17 USD’dir. Bunun üzerinden ödeme gideri, vergiler, bulut render, depolama, ağ, destek, ücretsiz kullanıcı gideri ve sabit altyapı daha düşülmemiştir. 0,98 USD görüp “çok kârlı” sonucu çıkarma. Özellikle yıllık indirimli plan ve yoğun kullanım birlikte test edilmelidir.

## Kaynak ile çıktı dakikası

20 dakikalık videonun tamamını yazıya çevirip 30 saniyelik klip üretmek 30 saniyelik ASR işi değildir. ASR sayacı işlenen kaynak aralıklarına; render sayacı çıktı tarifine dayanır. Kullanıcıya teklifte “20 dakika konuşma dökümü / 30 saniye video çıktısı” göster.

Modeli yeniden çalıştırmayan stil/renk düzeltmesi tekrar ücretlenmez. Aynı job’ın otomatik retry’ı kullanıcıdan iki kez düşmez; altyapı maliyeti yine kaydedilir. Kullanıcının yeni transkript üretimi veya değişmiş kaynağı işlemesi yeni iş olabilir. Kısmi başarılarda neyin kaydedildiği ve neyin ücretlendiği açık olmalıdır.

## Maliyet defteri ve kötüye kullanım

ASR, alignment, translation, render, storage, egress ve retries ayrı kolonlardır. Translation maliyeti gerçek karakter/token miktarıyla loglanır; kullanıcı kotası dil-dakika olarak kalabilir. Olağan dışı metin büyüklüğünü gizli sürpriz ücretle değil, başlamadan görülen sınır/teklif ile ele al.

Önerilen idempotency anahtarı: tenant + source fingerprint + işlenen aralıklar + model/ayar sürümü; çeviride kaynak metin revizyonu + hedef dil. Kullanıcılar arasında içerik hash’i üzerinden ortak cache oluşturma; varlık varlığını veya metni sızdırabilir.

Sunucu reserve → complete/commit → fail/release akışını uygular. Provider timeout sonrasında gerçek durum bilinmiyorsa körlemesine çoklu retry yapma. Kullanıcı kotası serbest bırakılmış olsa da provider faturası gelebileceğini maliyet kaydında koru.

Kaynaklar: [05_SOURCES.md](05_SOURCES.md).
