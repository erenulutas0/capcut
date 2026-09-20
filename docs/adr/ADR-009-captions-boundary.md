# ADR-009 — Altyazı ve transkript sınırı (tasarım notu, uygulama yok)

> Tarih: 2026-09-21 · Durum: TASARIM NOTU / uygulanmamış
> Kaynak: `transcript_araştırma/` (20 Eylül 2026 araştırma eki).

## Bu notun amacı ve sınırı

W0'da altyazı, transkript, çeviri veya herhangi bir AI entegrasyonu
**uygulanmadı**. Bu not yalnızca ileride eklenebilmesi için hangi sınırların
şimdiden korunduğunu ve hangi sırayla ilerleneceğini kaydeder.

Araştırma ekindeki fiyatlar, dakika hakları ve kotalar **onaylanmamış
önerilerdir**. Bu not onları canlı politikaya çevirmez.
`video-editor-blueprint/docs/15_PRICING_FREE_PRO.md` kanonik kalır ve
`src/domain/policy.ts` yalnızca oradaki web limitlerini taşır. EDL v1 şeması
değiştirilmedi; `captions` benzeri bir alan bugün validasyondan
`unknown_field` ile geçer (fixture: `invalid/unknown-top-level-field.json`).

## Korunan sınırlar

**1. Transkript ≠ görüntülenen altyazı.** Bunlar iki ayrı veri olacak:

- *Transkript*: kaynak asset'e bağlı, **kaynak zamanında** kelime/segment
  aralıkları. Düzenleme tarifinden bağımsızdır; klipler yeniden sıralanınca
  değişmez.
- *Altyazı track'i*: **çıktı zamanında** gösterilecek satırlar ve stil.

Bu ayrım W0'da zaten hazır: `src/domain/timeline.ts` içindeki
`mapOutputToSource` / `mapSourceToOutput` kaynak ve çıktı saatlerini birbirine
çeviren tek yerdir. Transkript kaynak zamanında üretilip aynı fonksiyonlarla
çıktı zamanına taşınacak. Aynı kaynak aralığı iki kez kullanıldığında bir
kaynak zamanı birden çok çıktı zamanına düşer; bu yüzden eşleme her zaman
klip index'i üzerinden yapılır (`mapSourceToOutput(project, clipIndex, us)`).

**2. Zaman birimi değişmez.** Integer mikrosaniye ve yarı açık
`[startUs, endUs)` altyazı cue'ları için de geçerli olacak; SRT/VTT'nin
milisaniye/saniye gösterimi yalnızca IO katmanında kalacak.

**3. Şema genişlemesi ayrı ve geriye uyumlu olacak.** EDL v1 sessizce
değiştirilmeyecek. Öneri: yeni alanlar `schemaVersion: 2` ile gelir,
`captionTracks` ve `transcripts` ayrı diziler olur, v1 projeler migration ile
okunur. Bu ADR bu şemayı **onaylamaz**; W1 bitmeden şema tartışması açılmaz.

**4. Sağlayıcı adaptörü sonradan takılır.** Bugün kod tabanında hiçbir ASR
veya çeviri arayüzü yok ve bilerek yok: uygulanmamış sağlayıcılar için boş
interface yığını üretmek AGENTS.md'ye aykırı. Geldiğinde `MediaEngine`
portuyla aynı yere oturacak: `src/domain/` içinde davranış sözleşmesi,
`src/adapters/` içinde tek implementasyon. Domain sağlayıcıya bağımlı olmaz.

**5. Ana akışta çalışmayan altyazı düğmesi yok.** Editörde altyazı girişi
bulunmuyor; hazır olmayan bir özellik için giriş noktası konmadı.

**6. Medya dışarı çıkmaz.** W0'da hiçbir dosya, thumbnail veya metin dış
servise gönderilmiyor (`tests/e2e/editor.spec.ts` → "nothing is sent off the
machine"). ASR eklendiğinde bu davranış **açık kullanıcı seçimi** olmadan
değişmeyecek; yükleme ayrı bir onay ekranı gerektirecek.

## Bağımlılık sıralı backlog

Her adım öncekinin kanıtı olmadan başlamaz.

1. **W1 — gerçek web video çıktısı.** Seçilen anlardan, doğru çerçeveyle ve
   ses miksiyle gerçek bir MP4. Altyazıdan önce bu olmalı: altyazıyı
   "videoya işlemek" için çalışan bir render hattı gerekir.
2. **Tek manuel altyazı satırının gerçek videoya işlenmesi.** Kullanıcının
   yazdığı bir satır, verilen çıktı aralığında, gerçek dosyada görünür.
   Burada layout, font gömme ve güvenli alan sorunları çözülür.
3. **SRT/VTT içe/dışa aktarma + manuel altyazı düzenleme ve zaman eşleme.**
   Kaynak/çıktı zaman eşlemesi ve yeniden sıralama davranışı test edilir.
4. **Kontrollü beta'da otomatik transkript.** Ayrı maliyet, kota, gizlilik ve
   açık rıza kapısı. Sağlayıcı seçimi o gün resmî dokümandan doğrulanır;
   araştırmadaki aday isimler (Scribe v2, `whisper-1`, `gpt-transcribe`)
   bugün seçilmiş sayılmaz.
5. **Türkçe–İngilizce altyazı çevirisi.** Çeviri dublaj değildir; orijinal ses
   değişmez. Çevrilmiş metni kaynak sesle kelime kelime zorla hizalamak
   kapsam dışıdır.

## Açık sorular (W1 bitene kadar karara bağlanmayacak)

- Transkript hangi kapsamda üretilecek: yalnızca tutulan anlar mı, tüm kaynak
  mı? İkisi farklı süre ve farklı maliyettir.
- Cue'lar klip yeniden sıralandığında otomatik mi taşınacak, yoksa kullanıcı
  onayı mı isteyecek?
- Altyazı stilinin EDL'e mi yoksa ayrı bir tema kaydına mı gireceği.
