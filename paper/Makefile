.DEFAULT_GOAL := all

LATEXMK ?= latexmk
ROOT_DIR := ..
BUILD_DIR := $(ROOT_DIR)/tmp/latex
OUTPUT_DIR := $(ROOT_DIR)/output/pdf
EN_BUILD_DIR := $(BUILD_DIR)/en
ZH_BUILD_DIR := $(BUILD_DIR)/zh
EN_OUTPUT := $(OUTPUT_DIR)/proactive-ai-from-turns-to-timelines.pdf
ZH_OUTPUT := $(OUTPUT_DIR)/proactive-ai-from-turns-to-timelines-zh.pdf
EN_LOCAL_OUTPUT := main.pdf
ZH_LOCAL_OUTPUT := main_zh.pdf
COMMON_SOURCES := references.bib acmart.cls ACM-Reference-Format.bst
FIGURE_SOURCES := figures/figure-style.tex \
	figures/conversation-examples.tex \
	figures/interaction-timelines.tex \
	figures/interaction-overview.tex \
	figures/system-architecture.tex \
	figures/prototype-inspection.pdf \
	figures/dialogue-patterns.pdf

.PHONY: all en zh export

all: en zh

en:
	@mkdir -p $(EN_BUILD_DIR)
	cp main.tex $(COMMON_SOURCES) $(EN_BUILD_DIR)/
	@mkdir -p $(EN_BUILD_DIR)/figures
	cp $(FIGURE_SOURCES) $(EN_BUILD_DIR)/figures/
	$(LATEXMK) -cd -pdf -interaction=nonstopmode -halt-on-error \
		$(EN_BUILD_DIR)/main.tex
	@test -s $(EN_BUILD_DIR)/main.bbl
	@if grep -Eq 'Citation .* undefined|Reference .* undefined|There were undefined citations|There were undefined references' $(EN_BUILD_DIR)/main.log; then \
		echo "English paper contains unresolved citations or references."; \
		exit 1; \
	fi
	cp $(EN_BUILD_DIR)/main.pdf $(EN_LOCAL_OUTPUT)
	@cmp -s $(EN_BUILD_DIR)/main.pdf $(EN_LOCAL_OUTPUT)

zh:
	@mkdir -p $(ZH_BUILD_DIR)
	cp main_zh.tex $(COMMON_SOURCES) $(ZH_BUILD_DIR)/
	@mkdir -p $(ZH_BUILD_DIR)/figures
	cp $(FIGURE_SOURCES) $(ZH_BUILD_DIR)/figures/
	$(LATEXMK) -cd -xelatex -interaction=nonstopmode -halt-on-error \
		$(ZH_BUILD_DIR)/main_zh.tex
	@test -s $(ZH_BUILD_DIR)/main_zh.bbl
	@if grep -Eq 'Citation .* undefined|Reference .* undefined|There were undefined citations|There were undefined references' $(ZH_BUILD_DIR)/main_zh.log; then \
		echo "Chinese paper contains unresolved citations or references."; \
		exit 1; \
	fi
	cp $(ZH_BUILD_DIR)/main_zh.pdf $(ZH_LOCAL_OUTPUT)
	@cmp -s $(ZH_BUILD_DIR)/main_zh.pdf $(ZH_LOCAL_OUTPUT)

export: all
	@mkdir -p $(OUTPUT_DIR)
	cp $(EN_LOCAL_OUTPUT) $(EN_OUTPUT)
	cp $(ZH_LOCAL_OUTPUT) $(ZH_OUTPUT)
	@cmp -s $(EN_LOCAL_OUTPUT) $(EN_OUTPUT)
	@cmp -s $(ZH_LOCAL_OUTPUT) $(ZH_OUTPUT)
