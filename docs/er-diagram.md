# ER-диаграмма

```mermaid
erDiagram
    CAMERA ||--o{ ZONE : "имеет"
    CAMERA ||--o{ VIDEO_FILE : "имеет"
    CAMERA ||--o{ VIOLATION : "фиксирует"
    ZONE ||--o{ PPE_RULE : "требует"
    ZONE ||--o{ VIOLATION : "в зоне"
    VIDEO_FILE ||--o{ VIOLATION : "найдено в"

    CAMERA { int id string name string source_type string source_uri bool is_active }
    ZONE { int id int camera_id string name bool is_active }
    PPE_RULE { int id int zone_id string code bool is_active }
    VIDEO_FILE { int id int camera_id string file float fps int frame_count float duration_sec }
    VIOLATION {
        int id
        int camera_id
        int zone_id
        int video_id
        json missing_ppe
        datetime timestamp
        datetime ended_at
        int frames_count
        float bbox_x1
        float bbox_y1
        float bbox_x2
        float bbox_y2
        float confidence
        string external_id
    }
```

Коды нарушений: NO_HELMET, NO_VEST, NO_GLOVES.
Employees (внешняя связь через `external_id`) добавляет DB-специалист.