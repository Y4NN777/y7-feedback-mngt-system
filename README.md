# SWE-BASICS-BEFORE-CODE
## Engineering Foundations — From Intent to Architecture

> **"Code is a liability. Logic is an asset."**

This repository is **not a coding tutorial**.  
It is a **thinking framework** for software engineers. It standardizes the mental process that must occur **before the first line of code is written**.

---

## Repository Purpose

The goal is to eliminate "coding by coincidence" by enforcing a strict chain of causality:
**Intent → Requirement → Contract → Responsibility → Architecture.**

If you skip these steps, you are not engineering; you are just typing.

---

## Reading Order (Strict)

These documents are designed to be read sequentially. Each builds upon the mental model established in the previous one.

| Sequence | Document | Role | Key Concept |
|:---:|:---|:---|:---|
| **00** | [**Foundation: Engineering Mindset**](./BASICS/00_foundation_engineering_mindset.md) | **Mental Model** | Distinguishing "Developer" (Solution) from "Engineer" (Problem). |
| **01** | [**Requirements: PRD**](./BASICS/01_requirements_prd.md) | **Product Vision** | Defining the *Problem* without hinting at the *Solution*. |
| **02** | [**Requirements: SRS**](./BASICS/02_requirements_srs.md) | **System Specifics** | Converting vague "needs" into verifiable **Requirements**. |
| **03** | [**Design: Contract & Invariants**](./BASICS/03_design_contract_invariants.md) | **System Laws** | Defining what the system *guarantees* and *forbids* (the rules that never break). |
| **04** | [**Transition: Req. to Arch.**](./BASICS/04_transition_req_to_arch.md) | **The Bridge** | Converting a *Guarantee* into a specific technical *Responsibility*. |
| **05** | [**Modeling: UML & C4**](./BASICS/05_modeling_uml_c4.md) | **Visual Design** | Structuring the responsibilities using standard notation. |

---

## Key Terminology

To ensure consistency, this repository uses the following definitions:

| Term | Definition |
|:---|:---|
| **Requirement** | A verifiable rule the system *must* satisfy. If it fails, the system is broken. |
| **Constraint** | A limitation imposed on the design (budget, latency, legacy compliance). |
| **Contract** | The immutable set of promises (inputs/outputs/guarantees) a system makes to its environment. |
| **Responsibility** | The ownership of a specific logic or data state. |
| **Invariant** | A truth that must remain true under all transformations (e.g., "Account balance cannot be negative"). |

---

## What This Is NOT

- **It is NOT** a tutorial on Python, Java, or React.
- **It is NOT** a guide to Agile or Scrum management.
- **It is NOT** a template for documentation generation.

It is a **methodology for conceptual correctness**.

---

## How to Use

1. **Read Sequence 00** to reset your assumptions.
2. **Apply 01 & 02** to your next project before opening your IDE.
3. **Draft your System Contract (03)** before designing your database schema.
4. **Use 04 & 05** to defend your architectural choices during review.

---

## Case of a Multivendor Ecosystem ( SahelArt Market )

[**Repository Code**](https://github.com/Y4NN777/SahelArt-Market/blob/main/docs/sahel_art_prd.md)
