# "LiloCut'a paylaş" — açılış ekranı, elde bir videoyla (17 Ekim 2026)

Karar kaydı: [ADR-047](../../adr/ADR-047-share-target.md). Kurucu özelliği onayladı; ekran **yeni bir düzen
değil**, var olan açılış ekranına ([ADR-034](../../adr/ADR-034-task-first-home.md)) var olan parçalarla bir
ekleme. Bu klasör kurucunun **veto** edebilmesi için: önce / sonra, telefon (360 × 780, 2×) ve masaüstü
(1440 × 900). Hepsi uygulamanın kendi ekran görüntüleri (test kancalı derleme, Playwright Chromium); paylaşım,
Android'in yaptığı gibi uygulamanın adresine giden bir POST ile, gerçek service worker'dan geçerek yapıldı.

## Ne değişti

| Önce | Sonra (elde bir video varken) |
|---|---|
| Başlık "Ne yapmak istiyorsun?" + "Birini seç, videonu ver, gerisi iki adım." | Başlık **"Bu videoyla ne yapmak istiyorsun?"**; altındaki cümlenin yerine videonun kutusu |
| — | Kutu: küçük resim (videonun ilk karesi), adı, süresi ("24,0 sn"), "Bir iş seç; video onda açılır.", **"Başka bir video seç"** (dosya seçme penceresi) |
| Kart → işin "Videonu seç" adımı | Kart → işin **bir sonraki adımı**, video açık ("GIF yap · Adım 2 / 3"); "Kes" doğrudan editör |
| Arama, örnekler, kartlar, "Kendim düzenleyeceğim", alt bilgi | Aynen; aramadan "Başla" da videoyla açar; yapılamayan işler yine "Bunu henüz yapamıyoruz." |

Kutu, sihirbazdaki video satırının (`.video-row`: ad + süre + "Değiştir") aynısıdır, yanına küçük resim ve
bir cümle eklendi; düğme örnek cümlelerin hap biçiminde. Renkler Quiet Studio belirteçleri. Elde video
yokken ekran **aynı** (kalite katmanının görsel karşılaştırması: tabanından farklı ekran 0; masaüstünde de,
paylaşma hedefi olmayan her tarayıcıda da).

## Ekranlar

| | Telefon | Masaüstü |
|---|---|---|
| Önce (bugünkü ekran) | [01-once-phone.png](01-once-phone.png) | [01-once-desktop.png](01-once-desktop.png) |
| Sonra: paylaşılan video | [02-sonra-phone.png](02-sonra-phone.png) · [tamamı](02-sonra-phone-tam.png) | [02-sonra-desktop.png](02-sonra-desktop.png) |
| "GIF yap"a dokununca (Adım 2 / 3, video açık) | [03-gif-yap-phone.png](03-gif-yap-phone.png) | [03-gif-yap-desktop.png](03-gif-yap-desktop.png) |
| Üç dosya birden paylaşıldı (resim + iki video) | [04-cok-dosya-phone.png](04-cok-dosya-phone.png) | [04-cok-dosya-desktop.png](04-cok-dosya-desktop.png) |
| Video olmayan bir dosya paylaşıldı | [05-video-degil-phone.png](05-video-degil-phone.png) | [05-video-degil-desktop.png](05-video-degil-desktop.png) |

Cümleler:

- birden çok dosya: "3 dosya paylaştın. Bir seferde bir video açılır: ilk videoyu aldım. Ötekiler için onları
  tek tek paylaş."
- video değil: "Paylaştığın dosya bir video değil. Bu uygulama yalnızca videolarla çalışır: galeriden bir video
  paylaş." (başlık ve kartlar her zamanki gibi)
- yer yok / okunamadı / artık yok: ADR-047 "Açılış ekranı".

## Kurucunun bakması istenenler

1. Kutu başlığın altında, aramanın üstünde. Telefonda kartlar bu yüzden ~150 px aşağı iner (360 × 780'de
   "Kes" kartı ekranın son dörtte birinde başlıyor; öteki kartlar kaydırınca). Elde video varken **örnek cümleleri gizlemek** kartları yukarı alır — bu
   uygulamada yapılmadı (ekran öncekiyle aynı kalsın diye); istenirse tek satır.
2. "Başka bir video seç" dosya seçme penceresini açar (sihirbazdaki "Değiştir" gibi). Videoyu bırakıp eski
   ekrana dönmenin ayrı bir yolu yok; kartlar her durumda çalışır.
