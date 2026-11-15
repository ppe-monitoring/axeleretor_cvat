# Датасет PPE
- Источник: https://universe.roboflow.com/yavuzhan-zom9x/construction-site-safety-hvfor (версия 1)
- Автор: yavuzhan-zom9x, Roboflow Universe. Лицензия: CC BY 4.0
- Формат: YOLOv8. Классы (11): Glasses, Glove, Hardhat, Mask, NO-Glove, NO-Hardhat,
  NO-Mask, NO-Safety Vest, Person, Safety Vest, no_glasses
- Размер: train 1691 / valid 265 / test 178 картинок (объектов 4807 / 834 / 794)
- Аугментация: ml/augment.py, factor 1, seed 42, только train.
  Эффекты: затемнение, размытие, шум, низкий контраст, дымка, JPEG-сжатие
- Размер train после аугментации: (число из отчёта)
- Замечания: Person размечен не на всех картинках; Glasses в test всего 3 объекта;
  распределение классов в train и test разное