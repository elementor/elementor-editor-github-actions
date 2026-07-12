#!/usr/bin/env python3
import re
import sys

template_path, areas_path, output_prompt_path, output_product_name_path = sys.argv[1:5]

with open(areas_path, encoding="utf-8") as f:
    areas_text = f.read()

name_match = re.search(r"^PRODUCT_NAME:\s*(.+)$", areas_text, re.MULTILINE)
enum_match = re.search(r"^PRODUCT_ENUM:\s*(.+)$", areas_text, re.MULTILINE)
areas_match = re.search(r"^PRODUCT_AREAS:\s*\n(.*?)\n+PRODUCT_ENUM:", areas_text, re.DOTALL | re.MULTILINE)

if not (name_match and enum_match and areas_match):
    sys.exit(
        f"{areas_path} must define PRODUCT_NAME, PRODUCT_AREAS, and PRODUCT_ENUM"
    )

product_name = name_match.group(1).strip()
product_areas = areas_match.group(1).strip()
product_enum = enum_match.group(1).strip()

with open(template_path, encoding="utf-8") as f:
    rendered = f.read()

rendered = (
    rendered
    .replace("{{PRODUCT_NAME}}", product_name)
    .replace("{{PRODUCT_AREAS}}", product_areas)
    .replace("{{PRODUCT_ENUM}}", product_enum)
)

with open(output_prompt_path, "w", encoding="utf-8") as f:
    f.write(rendered)

with open(output_product_name_path, "w", encoding="utf-8") as f:
    f.write(product_name)
