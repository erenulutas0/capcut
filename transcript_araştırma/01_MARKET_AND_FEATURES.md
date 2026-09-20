# 01 — Pazar, kullanıcı işleri ve özellik seçimi

> 20 Eylül 2026 · Ürün önerileri ile doğrulanmış dış gözlemler ayrı tutulmuştur.

## Pazar gözlemi

| Ürün | Resmî sayfada görülen örtüşme | Bizim için anlamı |
|---|---|---|
| Microsoft Clipchamp | Tarayıcı editörü, otomatik altyazı, ücretsiz HD/filigransız çıktı anlatımı. [S01] | Temel edit + ücretsiz altyazı tek başına ayırt edici değildir. |
| CapCut | Webde konuşma tanıma, düzenlenebilir altyazı stilleri, export akışı. [S02] | Mobil ve web beklentisi için doğrudan karşılaştırma ürünü. |
| VEED | Otomatik altyazı, stil ve çeviri araçları. [S03] | Basit altyazı/çeviri pazarı zaten işlenmektedir. |
| Kapwing | Tarayıcı editörü, transkriptten kesme, çeviri, otomatik kesme. Pro: aylık ödeme 24 USD; yıllık ödemede aylık eşdeğer 16 USD. [S04] | Web-first vizyonuyla güçlü örtüşme; aynı işi daha kolay yaptığımızı göstermeliyiz. |
| Descript | Metin tabanlı düzenleme; Underlord ile istekten düzenleme yaklaşımı. [S05] | “Yazarak düzenle” de tek başına yeni bir kategori değildir. |
| Submagic | Kısa içerik, altyazı, otomatik düzenleme, kırpma ve çeviri. [S06] | Kısa video odağında daha dar ürünler de var. |

Bunlar pazar payı sıralaması değildir. Rakiplerin doğruluk/hız yüzdeleri bağımsız test sonucu kabul edilmedi. Özellik bulunması, bizim hedef kitlemizin o üründen memnun veya memnuniyetsiz olduğunun kanıtı değildir.

## Konumlandırma önerisi

“İstediğin her video işlemini yap” çok geniş bir ürün sözüdür. İlk uygulanabilir söz:

> **Videonu seç. İstediğin anları tut. Altyazını ve müziğini ekle. Paylaşılabilir klibini indir.**

Aşırı basitlik çocuklara yönelik ürün geliştirmek anlamına gelmez. Hedef, video düzenleme deneyimi olmayan yetişkin kullanıcıların öğrenme gereksinimini azaltmaktır.

İlk hedef segment önerisi: Kısa konuşma, ürün veya hizmet tanıtımı hazırlayan Türkçe içerik üreticileri ve tek başına çalışan küçük işletmeler. Türkçe ve İngilizce akışları test et. Küresel ürün hedefini koru; ilk araştırmada bütün insanları tek hedef kitle sayma.

Ayrı test edilecek segmentler: kısa ders anlatan eğitmenler ve ara sıra kişisel klip hazırlayanlar. İkinci grubun düzenli abonelik isteği daha düşük olabilir; bu bir varsayım, doğrulanmış oran değildir.

## Kullanıcı ihtiyacı hipotezleri

Aşağıdaki tablo kullanıcı anketi değildir; mevcut ürün işlevlerinden ve ürünümüzün akışından çıkarılmış test adaylarıdır. Zorluk seviyeleri bizim kapsam tahminimizdir. “Ek API gerekmez”, geliştirme/cihaz/hosting maliyetinin sıfır olduğu anlamına gelmez.

| Kullanıcının işi | Uygulama yaklaşımı | Zorluk | Değişken maliyet | Öncelik |
|---|---|---|---|---|
| İstediğim kısmı tutayım | Mevcut an seçimi, kes/sırala | Orta | Yerelde üçüncü taraf API şart değil | Çekirdek |
| Ortadaki hatalı cümleyi çıkarayım | Önce bölüm seçimi; sonra metinden aralık seçme | Orta / ileri | Metin hazırsa yeniden ASR gerekmez | Çekirdek / sonraki |
| Altyazı yazayım veya SRT yükleyeyim | Yerel cue editörü, import/export | Orta | API gerekmez; burn-in render maliyeti ayrı | İlk genişleme |
| Konuşmam otomatik yazı olsun | ASR + kelime zamanları + düzeltme | Orta | İşlenen ses süresi | İlk AI deneyi |
| İngilizce altyazı da olsun | Onaylı transkript → çeviri track’i | Orta | Karakter/token ve hedef dil | İlk AI sonrası |
| Dikey yaparken yüzüm kesilmesin | Önce elle odak/fit; sonra takip | Orta / ileri | Yerel model veya işlem maliyeti | Elle şimdi, takip sonra |
| Konuşurken müzik kısılsın | Speech-aware ducking veya kontrollü ses zarfı | Orta | LLM gerekmez | Erken |
| Uzun boşluklar kısalsın | Ses analizi/VAD + kesim önerisi | Orta | Yerel analiz mümkün | Erken, opt-in |
| Logo ve başlık ekleyeyim | Basit metin/logo katmanı | Orta | Yerelde API gerekmez | İlk genişleme |
| Aynı tarzı tekrar kullanayım | Altyazı stili, oran, logo profili | Düşük / orta | Yerel depolama; bulut isteğe bağlı | Pro değeri adayı |
| Aynı videonun üç versiyonu olsun | Dikey/kare/yatay sıralı çıktı | Orta | Her render ayrı işlem | Pro değeri adayı |
| Dosyayı paylaşacak kadar küçülteyim | Basit kalite/boyut önayarları | Orta | Encode maliyeti | Erken |
| Konuşma gürültüsünü azaltayım | Basit filtre / ayrı AI temizleme | Orta / ileri | Seçilen motora göre; premium API pahalı olabilir | Ölçüm sonrası |
| Metinde kelime arayıp o ana gideyim | Transkript indeksi → kaynak zamanına seek | Orta | Yeni model çağrısı şart değil | Transkript sonrası |
| Şunu yap diye yazayım | Sınırlı intent → doğrulanmış düzenleme önerisi | İleri | Metin modeli + ürün doğrulaması | Çekirdek sonrası |
| Uzun kayıttan en iyi anı seç | Transkript/kare analizi + aday klip | İleri | Uzun girdi analizi | Sonra |
| Başka dilde sesimle konuşayım | Dublaj, ses hakları, süre uyumu | Yüksek | Ses/çeviri/gerekirse lip-sync | MVP dışı |
| Arka planı değiştir / 4K iyileştir | Segmentation/generative/super-resolution | Yüksek | GPU veya harici API | MVP dışı |

Ses seviyesi, sessizlik ve altyazı çizimi için model gerektirmeyen teknik araçlar da vardır; FFmpeg dokümantasyonu bu işlem türlerini gösterir. Bu, aynı filtrelerin tarayıcıda otomatik çalışacağı anlamına gelmez. [S14]

## UI kapsamını büyütmeden genişletmek

Ana ekranda dört iş: **Kısalt · Altyazı ekle · Görüntüyü ayarla · Ses ekle**. Kullanıcı bir iş seçince ilgili kontroller görünür. Uzman parametreleri “Ayrıntılar” içine al. Prompt yazmak zorunlu değildir.

Altyazı panelinin ilk görünümü: konuşma dili, çıktı dili, üç okunaklı stil ve “Oluştur”. İki dil farklıysa çeviri maliyetini başlamadan göster. Sonraki görünümde metne tıklayıp düzeltme, yerleşim ve çıktı bulunur.

İlk defa gelen kullanıcıya fps, codec, timebase, token veya VAD gösterme. Fakat teknik sınırları saklama: desteklenmeyen dosya ve işlemin yapılamadığı durum açık açıklanmalı.

## Neyi üstünlük olarak söylemeyeceğiz?

“Kimsede yok”, “yüzde 99,9 doğru”, “her dil”, “her telefonda çalışır”, “her videoyu viral yapar” ve “sınırsız AI” iddiaları yok. “Yerel düzenleme” ile “bulutta ses analizi” birbirinden ayrılır. Ücret son adımda sürpriz olarak çıkmaz.

Farklılaşma hedeflerimiz: açıklamasız ilk başarı, geri alınabilir otomasyon, iyi Türkçe düzeltme akışı, anlaşılır maliyet ve güvenilir çıktı. Bunların rakiplerden iyi olduğu ancak karşılaştırmalı görev testiyle söylenebilir.

Kaynaklar: [05_SOURCES.md](05_SOURCES.md).
