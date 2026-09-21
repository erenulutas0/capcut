# ADR-018 — Sessizlik kesim önerisi (ilk yerel AI deneyi)

> Tarih: 2026-09-22 · Durum: KABUL EDİLDİ (kurucu: transkript rafa, sessizlik önerisine geç)
> Belge 31'in "İlk AI deneyi"dir. Transkript (ADR-017) ücretsiz rotada eşikleri
> tutmadığı için ertelendi. Bu özellik tamamen yereldir: dış servis, model
> indirme, hesap ve maliyet yoktur.

## Karar

**Ne yapar:** Seçili anlardaki uzun duraklamaları bulur ve kesilmesini
**önerir**. Kullanıcı listeyi görür, dinler, tek tek açıp kapatır ya da
ayarları değiştirir; onaylarsa tek bir geri alma adımıyla uygulanır. Hiçbir
şey otomatik kesilmez (belge 31: "AI önerisi veri, komut değil").

**Nasıl bulur (`domain/silence.ts`, saf ve açıklanabilir):**
- Kaynak ses 10 ms'lik karelerde ölçülür (mono RMS, dBFS). Bunu bir adaptör
  worker'da yapar, dosya bilgisayardan çıkmaz.
- Eşik uyarlanır: sessiz seviye (10. yüzdelik) ile konuşma seviyesi (95.
  yüzdelik) arasında bir yerde. Sessizden en az 6 dB yukarıda, konuşmadan en
  az 12 dB aşağıda durur. Dijital sessizlik boşlukları eşiği aşağı çekmez.
- 60 ms'den kısa sesler (tık, dudak sesi) bir duraklamayı bölmez.
- Varsayılan en kısa duraklama 0,7 sn'dir. Kelime başı ve sonu kesilmesin diye
  konuşmaya bitişik her tarafta 150 ms pay bırakılır. Anın kenarında pay
  gerekmez. Paydan sonra 200 ms'den kısa kalan kesim önerilmez.
- Yüksek ile sessiz seviye arasında 12 dB'den az fark varsa (sürekli müzik,
  gürültü) **öneri yoktur** ve nedeni söylenir.

**Bilerek yapmadıkları:** Konuşma modeli değildir; "konuşmasız" değil
"sessiz" yerleri bulur. Arka plan müziği altındaki duraklamayı önermez. Bu
güvenli hata yönüdür: kaçan bir duraklama kullanıcıya bir saniyeye mal olur,
yanlış bir kesim ise bir heceye. Nefes seslerini ayırt etmez; pay onları
korur.

**Uygulama (`applySilenceCuts`):**
- Her an, kalan parçalara bölünür. İlk parça anın kimliğini korur; bütün
  parçalar anın ayarlarını (ses seviyesi, sessize alma, görünüm) taşır.
- 0,1 sn'den kısa kalan parça bırakılır ve sayılır.
- **20 an sınırı gevşetilmez** (politika, belge 15). Sınır aşılacaksa
  `selectWithinClipLimit` en uzun kesimleri seçer ve dışarıda kalanların
  sayısını söyler. Anın kenarındaki kesim yeni an eklemediği için sınır
  dolsa da alınabilir.
- Görüntüye bağlı altyazılar (ADR-016) kesimle birlikte kayar. Sonuca bağlı
  altyazılar yerinde kalır; arayüz bunu uygulamadan önce söyler.

## Ölçüm kapısı (belge 31)

Özellik ana akışa, ölçüm raporu bu eşikleri gösterirse girer:
- **Kaynak:** Hakları temiz konuşma (FLEURS, CC-BY-4.0) ile kurulmuş, doğru
  cevabı bilinen test dosyaları: bilinen uzunlukta boşluklar.
- **Koşullar:** Temiz, oda tonu, düşük ses, gürültü, müzik; Türkçe ve
  İngilizce. En az 20 dosya.
- **Konuşma kesilmesi (en önemli):** Önerilen kesimlerin içinde, ffmpeg'in
  bağımsız ölçümüne göre konuşma seviyesinde ses olmamalı: 0 vaka.
- **Bulma:** Temiz ve oda tonlu dosyalarda en kısa duraklamadan uzun
  boşlukların en az %90'ı önerilmeli.
- **Sınır doğruluğu:** Önerilen kesimin kenarı, gerçek boşluk kenarından pay
  kadar içeride olmalı; p95 sapma ≤ 50 ms.
- **Müzik:** Müzikli dosyalarda yanlış kesim olmamalı (öneri yok kabul
  edilir).
- **İnsan değerlendirmesi:** Belge 31'in istediği "hece kesildi mi"
  kontrolü küçük bir örneklemde yapılır ve raporda yazar.

Eşikler tutmazsa özellik ana akışa girmez; sonuç raporda yazılır.
