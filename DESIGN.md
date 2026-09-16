---
name: DeployThisShit
description: A shipping-manifest operations console for self-hosted releases.
colors:
  safety-vermilion: "#ec4d27"
  safety-vermilion-deep: "#b72e12"
  paper: "#f4f1ea"
  paper-raised: "#fbfaf6"
  carbon: "#171817"
  carbon-muted: "#575d5e"
  rule: "#b9b8b1"
  rule-dark: "#737673"
  live-sage: "#278a52"
  live-sage-pale: "#dcebdd"
  route-blue: "#145db4"
  danger-pale: "#f6ded7"
  focus-orange: "#ff6038"
typography:
  display:
    fontFamily: "Archivo Variable, Arial Narrow, sans-serif"
    fontSize: "clamp(2.75rem, 5vw, 4.5rem)"
    fontWeight: 820
    lineHeight: 0.88
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Archivo Variable, Arial Narrow, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 780
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Archivo Variable, Arial Narrow, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  data:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.08em"
rounded:
  field: "3px"
  control: "4px"
  round: "50%"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.safety-vermilion}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "40px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.carbon}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "40px"
  field:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.carbon}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
    height: "40px"
---

# Design System: DeployThisShit

## Overview

**Creative North Star: "The Shipping Manifest"**

DeployThisShit feels like a live waybill laid across an operations desk: warm paper, carbon ink, ruled registers, route marks, and terse machine data. Its density is purposeful. The interface should reveal the relationship between application, release, route, device, and server instead of hiding those facts behind soft cards.

The system is editorial but not nostalgic. Real operational state supplies the character; decoration stays subordinate. Safety vermilion is rare and decisive, while movement is reserved for a release that is actually progressing.

**Key Characteristics:**

- Warm paper surfaces framed by carbon navigation.
- Ruled, continuous information planes instead of floating cards.
- A single safety color for primary actions, routing marks, and focus.
- Monospace only for hashes, ports, timestamps, codes, and measurements.
- State communicated with a shape, a word, and color together.

## Colors

The palette borrows from printed logistics documents: quiet paper and ink carry most of the screen, while route colors have explicit operational jobs.

### Primary

- **Safety Vermilion:** Primary actions, active routing rules, and deployment progress. Its rarity makes it decisive.
- **Deep Vermilion:** Hover states, error copy, and stronger warning emphasis.

### Secondary

- **Live Sage:** Healthy services and resource meters, always paired with a state word or icon.
- **Route Blue:** Public links and navigable routes.

### Neutral

- **Manifest Paper:** The main working surface.
- **Raised Paper:** Inputs, selected planes, and the login sheet.
- **Carbon Ink:** Navigation, headings, and primary text.
- **Muted Carbon:** Supporting copy and secondary metadata.
- **Rule / Dark Rule:** The hierarchy of dividers that gives the manifest its structure.

**The One Route Mark Rule.** Safety vermilion marks one primary action or active route in a local region; it is not a general decoration color.

## Typography

**Display Font:** Archivo Variable (with Arial Narrow and sans-serif fallbacks)  
**Body Font:** Archivo Variable (with Arial Narrow and sans-serif fallbacks)  
**Label/Mono Font:** IBM Plex Mono (with monospace fallback)

**Character:** Archivo brings compressed editorial authority without becoming industrial cosplay. IBM Plex Mono makes operational identifiers visibly distinct while remaining secondary to readable prose.

### Hierarchy

- **Display:** Heavy, compressed, and tightly tracked for the page name and login proposition.
- **Headline:** Compact application and section names with a clear step down from display type.
- **Body:** Neutral, readable interface copy; explanatory text remains roughly 45–62 characters wide.
- **Data:** Small monospace for values that benefit from fixed rhythm: releases, ports, machine identity, pairing codes, and manifest references.

**The Data Earns Mono Rule.** Monospace appears only when the content is code, identity, time, or measurement; ordinary navigation and prose stay in Archivo.

## Layout

Desktop uses a 194px carbon rail, a thin utility bar, and a flexible manifest plane. The primary deployment view adds a 330px inspector without lifting it into a separate visual world. Information is grouped through column spans, one-pixel rules, and 14–24px working gutters.

At 1180px the navigation compacts to an icon rail. At 900px the inspector enters document flow. At 680px the navigation becomes a fixed top rail, summary cells form a two-column register, the deployment strip becomes labeled records, and wide tables retain deliberate horizontal scrolling.

## Elevation & Depth

The operations interface is flat by default. Depth comes from dark-light contrast, ruled boundaries, inset selection marks, and sticky positioning. The login sheet alone uses a broad ambient shadow because it is an authentication layer placed above the carbon field.

**The Same Plane Rule.** Related operational data shares one ruled surface; do not turn each fact into a floating card.

## Shapes

Corners are nearly square. Fields use a 3px radius and controls use 4px; circular geometry is reserved for status dots, compact counters, and operator identity. Containers use crisp rectangular silhouettes and one-pixel rules. The system does not use pills for ordinary controls.

## Components

### Buttons

- **Shape:** Compact rectangular controls with gently eased corners.
- **Primary:** Safety vermilion with white text and a darker one-pixel keyline.
- **Hover / Focus:** Hover deepens the vermilion and lifts by one pixel; keyboard focus adds the bright orange ring plus a carbon outer keyline.
- **Secondary:** Transparent paper with a dark rule; hover adds a quiet neutral fill.

### Cards / Containers

- **Corner Style:** Square for operational containers.
- **Background:** Paper or a translucent raised-paper wash.
- **Shadow Strategy:** No resting shadow in the application shell.
- **Border:** One-pixel rules organize the content; an active deployment may use a vermilion top route rule.
- **Internal Padding:** Usually 14–24px, reduced in dense registers.

### Inputs / Fields

- **Style:** Raised paper, dark one-pixel rule, 3px corners, and 40px minimum height.
- **Focus:** Bright orange outline with a carbon keyline; no glow.
- **Disabled:** Reduced opacity only when the label still names the unavailable action.

### Navigation

The desktop rail is carbon with single-weight Lucide icons, quiet labels, and a vermilion active route mark. At phone width it becomes a 64px top rail with the same icon order and a bottom active rule. Tooltips or accessible labels must preserve icon meaning when text collapses.

### Status Marks

A status is always a consistent icon plus a written state. Live uses a filled circle, stopped a square, deploying a rotating progress mark, and failed an alert symbol. Color reinforces but never carries the state alone.

### Deployment Manifest

The signature component is a continuous release register: an active shipment strip, ruled rows, machine values, and an in-plane inspector. Selection changes the row wash and adds a routing rule; deployment motion travels left to right through a single lane.

## Do's and Don'ts

### Do:

- **Do** make operational relationships visible through shared ruled planes.
- **Do** pair every state color with a word and a consistent icon.
- **Do** keep primary actions explicit: “Stop site,” “Roll back,” and “Approve device.”
- **Do** preserve the compact top-rail transformation below 680px.
- **Do** respect reduced-motion preferences for progress and control transitions.

### Don't:

- **Don't** use gradients, glass, decorative grain, or soft card stacks.
- **Don't** use safety vermilion as an all-purpose highlight.
- **Don't** use monospace to make ordinary copy look technical.
- **Don't** hide destructive consequences behind ambiguous icons or labels.
- **Don't** communicate live, stopped, deploying, or failed state through color alone.
