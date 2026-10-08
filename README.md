<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/school-logo-light.png">
    <img src="assets/school-logo.png" width="160" alt="شعار مدرسة محمد بن إبراهيم الخضير الثانوية للموهوبين والموهوبات">
  </picture>
</p>

<div dir="rtl" lang="ar">

# أجزاء الصاروخ

صاروخ تفاعلي ثلاثي الأبعاد لطلاب المرحلة الثانوية. مرّر المؤشر فوق أي جزء (أو المسه على الشاشات اللمسية) ليظهر اسمه بالعربية والإنجليزية ووظيفته.

**الموقع:** https://asmaasma1111.github.io/rocket-parts-3d/

## طريقة الاستخدام

- **من الخارج / من الداخل:** يعرض الأجزاء الخارجية، أو يجعل الغلاف الخارجي شفافًا لتظهر الأجزاء الداخلية.
- **فصل المراحل:** تنفصل المعززات الجانبية، ثم المرحلة الأولى، ثم ينفتح غطاء الحمولة. يعيد زر **إعادة التجميع** الصاروخ كما كان.
- **قائمة الأجزاء:** جميع الأجزاء مرتبة حسب أنظمتها، ويمكن التنقل فيها بلوحة المفاتيح.
- **ألوان الأنظمة:** تظهر في العرض الداخلي؛ مرّر المؤشر فوق أي لون ليضيء النظام كله.
- اسحب لتدوير الصاروخ، واستخدم عجلة الفأرة أو إصبعين للتكبير والتصغير. اضغط على جزء لتثبيت بطاقته، واضغط على مساحة فارغة لإغلاقها.

## المصدر العلمي

روجع محتوى الأجزاء بالاستناد إلى موقع ناسا: [NASA Glenn Research Center, Beginner's Guide to Rockets](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-parts).

## شكر وتقدير

<!-- CREDITS: to be filled in -->
*يضاف لاحقًا.*

## الرخصة

الشيفرة متاحة برخصة MIT (انظر ملف `LICENSE`). شعار المدرسة غير مشمول بهذه الرخصة، وجميع حقوقه محفوظة للمدرسة.

</div>

---

# Rocket Parts

An interactive 3D rocket for secondary-school students. Hover over any part (or tap it on a touchscreen) to see its name in Arabic and English and what it does.

**Live site:** https://asmaasma1111.github.io/rocket-parts-3d/

## How to use

- **Outside / Inside:** show the outer parts, or turn the outer skin into faint glass to reveal the parts inside.
- **Separate stages:** the side boosters peel away, the first stage drops, then the payload fairing opens. **Reassemble** puts the rocket back together.
- **Parts list:** every part, grouped by system. Works with the keyboard (Tab, Enter, Esc).
- **System colours:** shown in the inside view; hover over a colour to light up the whole system.
- Drag to rotate; scroll or pinch to zoom. Click or tap a part to pin its card, and click or tap empty space to close it.

## Run it locally

It is a static site with no build step:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Three.js 0.170.0 is included in `vendor/three/`, so the page does not depend on a CDN.

## Content source

Part descriptions were checked against [NASA Glenn Research Center, Beginner's Guide to Rockets](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-parts).

## Credits

<!-- CREDITS: to be filled in -->
*To be added.*

## Licence

The code is released under the MIT Licence (see `LICENSE`). The school logo is not covered by this licence; all rights remain with the school. Three.js is MIT-licensed (`vendor/three/LICENSE`).
