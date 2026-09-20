# Mobil tasarım — webden sonra, yeniden düşünülerek

> 20 Eylül 2026 · UI v0.2 · Önerilen tasarım ve uygulama sözleşmesi. Kullanıcı testi veya üretim hazır oluş kanıtı değildir.

## İki farklı şey

**Mobil web** responsive tarayıcı deneyimidir; **native mobil** sonraki Flutter + platform motorlarıdır. Masaüstünde çalışan codec'in iPhone tarayıcısında aynı işi yapacağı veya arka planda sürdüreceği varsayılmaz [U12/U13]. İlk yayın destekli desktop webdir. Telefon landing/demo düzgün görünür; gerçek export mobil tarayıcı için ayrıca test kapısından geçer.

Native uygulama hazır değilken “Uygulamayı indir” butonu koyma. Web ilk sürümde native ürünü varmış gibi mağaza rozetleri gösterme.

## Telefon ekranı — önerilen temel düzen

Üst: geri, proje adı, dışa aktar. Aşağı: Kaynak/Sonuç switch, büyük preview, playhead/time. Onun altında büyük başlangıç/bitiş işaretleme ve `Anı ekle`. An kartları yatay veya tek kolon; çift yönlü drag yerine görünür öne/arkaya eylemi. Alt bar: **Anlar / Görüntü / Ses / Dosya**. Her araç kendi bottom sheet'ini açar; dördü aynı anda değil.

Preview'ı her sheet açıldığında yok etme. Uzun ayar panelinde yeterli içerik kaydırması; klavye açıkken input ve hata birlikte görünür. Safe area inset kullan. 390×844 tasarım referansıdır, tek destek ölçüsü değildir. 360×800 ve 320px genişlik de değerlendirilir.

## Dokunmatik sözleşme

Ürün hedefi 48×48 CSS px dokunmatik web; native Android'de en az 48dp önerisi [U08]. iOS kontrol ölçülerini hedef platformun güncel rehberi ve fiziksel cihazla ayrıca doğrula; CSS px ile dp/pt'yi aynı ölçüm diye sunma. 24px ikonun çevresinde hit alanı geniş olabilir; komşu alanların üst üste gelmesi kabul edilmez.

Klip kenarı sürüklenirken büyüteç/thumbnail önerisi W2/M1 sonrasında; ilk gün şart değil. Zaman inputu ve ±100ms kontrolleri görünür alternatiflerdir. Gerçek frame timestamps olmadan “1 kare” diye 1/fps ekleme.

## Native'e taşınacaklar

İsimlendirme, renk/space token semantiği, an kartı modeli, EDL/fixture sözleşmesi, export state isimleri, microcopy, test senaryoları. React bileşeninin Flutter'da birebir aynı kodu çalışacağı iddiası yok. Native picker/izin, storage, background/lifecycle ve share/save paneli platforma göre uygulanır.

## Native'e taşınmayacaklar

Desktop 3 kolon, hover-only tooltip, browser download varsayımları, blob URL saklama, dar küçük kontroller, web cookie/session modeli. Cloud sync ilk günden var sayılmaz. EDL taşınabilirliği kaynak dosyalarının otomatik taşındığı anlamına gelmez.

## Native geçiş kapısı

Önerilen ürün kararı: desktop W2'de gerçek export ve kurtarma akışı geçsin; en az 10 görev gözlemi ve tekrar kullanım ihtiyacı toplansın. Bu küçük örneklem istatistiksel genelleme değildir. M1'de önce tek native platform medya kanıtı, sonra UI uyarlaması. İki native motoru paralel zorunluluk yapma.

## HTML önizleme sınırı

`design-preview/editor.html` dar ekranda aynı görsel dili gösterir. Native uygulama veya mobil export kanıtı değildir. Alt panel davranışı tasarım tartışması için çalışır; VoiceOver/TalkBack/fiziksel cihaz doğrulaması henüz yapılmadı.
