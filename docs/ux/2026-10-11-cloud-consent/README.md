# "Yazıyı nerede çıkaralım?" — bulut yazıya dökme için rıza ekranı (kurucu kararı, 11 Ekim 2026)

Bulut yazıya dökme yolu (ADR-039) videonun sesini cihazdan çıkaran ilk özelliktir. Kullanıcıya
bunu nasıl soracağımız için taslaklar çizildi; kurucu **B · "İki yol yan yana"** seçeneğini
seçti. Bu klasör o seçimin kaydıdır.

- `B-IkiYol.dc.html` — onaylanan taslak (telefon boyutu, 390 × 844; uygulamanın kendi renkleri).
  Taslak dosyası tuval aracının `support.js` dosyasını ister; burada yalnızca kayıt olarak durur,
  uygulama onu kullanmaz.
- `shots/` — **çalışan uygulamadan** alınmış ekranlar (Playwright; bulut derlemesi, yerel sahte
  sunucuya karşı: `web/tests/cloud/cloud-shots.spec.ts`).

## Onaylanan ekran

"Yazıya dök" sihirbazında, yazıya dökme başlamadan önce tek bir ekran: **"Yazıyı nerede
çıkaralım?"** ve eş ağırlıkta iki kart.

| | Cihazımda | İnternette |
|---|---|---|
| Söz | Hiçbir şey gitmez. Daha yavaş, biraz daha az doğru. Kimin konuştuğunu ayırmaz. | Daha doğru, çok daha hızlı. Kimin konuştuğunu da ayırır. |
| Olgular | — | **Yalnızca ses** gider, görüntü gitmez. · **AssemblyAI** adlı şirketin Avrupa'daki bilgisayarlarına gider. · Yazı gelince oradaki ses ve yazı **silinir**. · Başka insanlar konuşuyorsa **onların sesi de gider**. |
| Süre / dakika | dürüst bir süre satırı | "Yaklaşık N dakika sürer · X dakika düşer, Y dakikan kalır" |
| Düğme | **Cihazımda yaz** (çerçeveli) | **Sesi gönder ve yaz** (dolu) |

İkisinin altında gizlilik sayfasına bağlantı. Telefonda kartlar alt alta, masaüstünde yan yana.

## Uygulandı (11 Ekim 2026) — kapalı doğar

Karar kaydı: [ADR-039](../../adr/ADR-039-cloud-transcript-route.md), "İstemci yapıldı" bölümü.
Ekran yalnızca vekil sunucuyu adlandıran derlemede vardır (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`);
yayındaki sitede yoktur. Taslaktan farklar ve nedenleri:

- **Cihaz kartındaki süre satırı bir sayı söylemiyor.** Taslakta "Yaklaşık 12 dakika sürer"
  yazıyordu; cihaz üstü süre cihaza göre çok değişir ve elimizde her cihaz için dürüst bir
  tahmin yok. ADR-036'nın cümlesi kullanıldı: "Konuşmanın süresinin yarısı kadar sürebilir;
  yavaş cihazda daha uzun." Model henüz indirilmemişse boyutu da söylenir ("İlk seferde 108,8 MB
  model indirilir.").
- **Cihaz kartına "Şimdilik yalnızca İngilizce." eklendi.** Onaylanan metinde yoktu; ama cihaz
  üstü tanıyıcı yalnızca İngilizce yazıyor ve bunu seçimden *önce* söylemezsek Türkçe konuşan
  biri yanlış yolu seçer. **Kurucunun onayına sunulur.**
- **İnternette kartındaki süre ölçümden geliyor.** "Yaklaşık N dakika": 11 Ekim'deki gerçek
  ölçümün (12 dosya) üst sınırı — 20 sn + ses dakikası başına 0,75 sn — tam dakikaya yukarı
  yuvarlanır (`web/src/domain/cloudTranscript.ts`). Cihazda sesin hazırlanması ve yavaş bir
  bağlantı bu sayıya dahil değildir (ölçülmedi).
- **Davet kodu.** Kod kayıtlı değilken İnternette kartında "Bunu kullanmak için davet kodu
  gerekiyor." + alan + "Kodu kaydet" durur (düğme, "Cihazımda yaz" ile aynı boyda). Kod
  kayıtlıyken iki kartın altında, gizlilik bağlantısının yanında "Davet kodunu kaldır" vardır.
- **Video önizlemesi bu ekranda yok** (taslaktaki gibi): soru ve iki cevabı ekranın kendisidir;
  videonun adı ve "Değiştir" kalır.
- **Sayfanın altındaki cümle.** Ses gönderilirken "Yalnızca ses gönderilir; görüntü cihazından
  çıkmaz.", sonuç ekranında "Bu videonun sesi yazıya dökülmek için internete gönderildi; görüntüsü
  cihazından çıkmadı." yazar — "Videon cihazından çıkmaz." cümlesi o iki ekranda tek başına
  yanıltıcı olurdu.
- **Konuşmacılar.** Sonuç ekranında ses değiştiği satırda "1. kişi / 2. kişi" yazar; metin
  dosyasında da. Tarife (EDL) yazılmaz — ayrıntı ADR-039'da.

Bağlayıcı kurallar (ADR-039 "Rıza ekranı"): bulut yolu her seferinde kullanıcının açık
eylemiyle başlar; ön seçili değildir, seçim hatırlanmaz; düğmeye basılmadan ses çıkmaz; iki
düğme aynı boydadır; kanıtlayamayacağımız söz yoktur ("güvenli", "şifreli", "anonim", "kimse
dinlemez", "eğitimde kullanılmaz"). Hepsi sınanır: `web/tests/cloud/`, `web/tests/unit/cloudBuild.test.ts`.
