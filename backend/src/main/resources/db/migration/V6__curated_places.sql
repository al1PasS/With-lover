ALTER TABLE places ADD COLUMN visit_date DATE;
ALTER TABLE places ADD COLUMN description VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE places ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE places SET panorama_image = reference_image WHERE panorama_image = '' AND reference_image <> '';
