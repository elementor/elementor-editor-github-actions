#!/usr/bin/env python3
import sys

template_path, product_name, output_path = sys.argv[1:4]

with open(template_path, encoding="utf-8") as f:
    rendered = f.read().replace("{{PRODUCT_NAME}}", product_name)

with open(output_path, "w", encoding="utf-8") as f:
    f.write(rendered)
