# Şablon — Özellik Spesifikasyonu

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: DOLDURULMUŞ ÖRNEK ŞABLON — UYGULANMADI
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Doldurulmuş örnek: P1-03 Klip sırasını değiştirme

**Kullanıcı işi:** İyi sahneleri seçtim ama son seçtiğim sahne videonun başında olmalı. Baştan seçim yapmadan sıralamak istiyorum.

**Kanıt durumu:** PRD'den gelen ihtiyaç önerisi; gerçek görüşme kanıtı henüz yok. Araştırma sonucu eklenecekse katılımcı kodu ve izinli not referansı kullanılmalı.

**Kapsam:** Klip kartını taşıma; klavye/screen-reader için öne/arkaya al; undo/redo; preview ve export sırasının EDL dizi sırasını izlemesi.

**Kapsam dışı:** Video katmanları, geçişler, otomatik hikâye sıralama, source dosyasını değiştirme.

## Kabul senaryoları

Given [A,B,C] klipleri; When kullanıcı C'yi başa taşır; Then EDL [C,A,B] olur ve toplam süre değişmez.

Given bir klip seçili; When en baştayken “Öne al” denenir; Then açıklayıcı disabled durumu, domain'de gereksiz revision yok.

Given bir taşıma tamamlanmış; When undo; Then eski sıra ve seçili clip ID geri gelir, kaynak dosyalar aynı kalır.

Given ekran okuyucu açık; When klip taşıma düğmeleri kullanılır; Then yeni sıra ve süre okunabilir şekilde bildirilir.

## Veri ve teknik etki

Yeni schema alanı gerekmiyor; `clips` sırası kanonik. UI index'i kimlik yerine kullanmaz; `clipId` sabit. Async thumbnail eski sırayla gelse bile yanlış karta bağlanmaz. Kaydetme revision ile yapılır; export başlarken recipe snapshot alınır.

## Analitik ve gizlilik

İhtiyaç varsa `meaningful_edit_completed` içinde `edit_type=reorder` enum'u; clip timestamp, başlık veya thumbnail gönderilmez. İzinli ürün analitiği yoksa yerel temel iş çalışmaya devam eder.

## Test planı

Unit list order/süre invariants; integration undo/autosave; UI keyboard/screen-reader; media fixture export sırası. Sonuçlar henüz çalıştırılmadı. UI screenshot yalnız başına çıktı sırasının kanıtı değildir.

## Yayın ve rollback

P1 ilgili testler geçince açılır; yeni provider/secret/ücret gerekmez. Regresyon varsa son güvenli reorder implementasyonuna dönülür; mevcut EDL kayıtları destructive migrate edilmez.

## İş sonucu raporu alanları

Gerçek commit, değişen dosyalar, çalıştırılan komutlar, pass/fail/not-run kanıtı, açık risk, yeni dependency/lisans etkisi. Bu alanlar görev bittiğinde gerçek değerlerle doldurulur; örnek diye uydurma commit/test sonucu yazılmaz.
