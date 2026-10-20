# PoultryOS — Android XML resources (demo screens)

Material 3 layouts matching the mobile demo, for an Android (Kotlin) build or as a spec for the Flutter screens.

res/layout
  activity_main.xml          shell: tenant chip, bell, fragment host, 5-tab BottomNavigationView (menu/bottom_nav.xml)
  fragment_home.xml          greeting + live indicator, 4 quick actions, 2×2 KPI tiles, attention list, market rates, batches
  fragment_daily_log.xml     supervisor daily entry: shed chips, birds, eggs by grade, feed & water, climate, photos → AI, remarks, save
  fragment_attendance.xml    People: tabs Today / Monthly register / Wages (ViewPager2) + submit button
  page_attendance_month.xml  monthly register grid (horizontal scroll) + month-to-date summary + export
  fragment_equipment.xml     equipment KPIs, open tickets, asset register (Report issue / Service done)
  sheet_generic_form.xml     bottom sheet for every + Add / action; fields filled from a schema (same pattern as the web demo)
  item_*.xml                 row templates: batch, alert, rate row, KPI tile, quick action, photo slot, worker attendance, register row, asset, ticket
res/values     colors.xml (palette), strings.xml (English), styles.xml (Theme.PoultryOS, Eyebrow, Field)
res/values-te  strings.xml (Telugu)
res/menu       bottom_nav.xml
res/drawable   card/tile/pill shapes, placeholder vector icons (swap for your icon set)

Dependencies: com.google.android.material:material:1.12+, androidx.navigation, androidx.recyclerview, androidx.viewpager2,
com.github.PhilJay:MPAndroidChart:v3.1.0 (sparklines / production chart). Data layer: supabase-kt (io.github.jan-tennert.supabase)
with the same schema in ../supabase/.

demo/poultryos_demo_data.xml — the complete VKR Poultry Farms + KS Farms dataset as XML (tenants, farms, sheds, batches with daily
logs and vaccinations, vendors, customers, items, stock, POs, bills, invoices, workers, assets, tickets, vet visits, AI cases,
60-day market rates, disease cards, breed standard curves) for import or validation.
