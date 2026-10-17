"""Writes the routing test drawings in crates/setsquare-core/tests/fixtures/routing.

Each drawing exercises one part of draw.io's connector geometry. The oracle script
then asks draw.io itself how it routes and draws every connector in them.
"""

import math
import pathlib
import sys
from xml.sax.saxutils import quoteattr

OUT = pathlib.Path(__file__).resolve().parents[2] / "crates/setsquare-core/tests/fixtures/routing"


class Page:
    def __init__(self, name):
        self.name = name
        self.cells = []

    def vertex(self, cid, style, x, y, w, h, value="", parent="1"):
        self.cells.append(
            f'<mxCell id="{cid}" value={quoteattr(value)} style={quoteattr(style)} vertex="1" parent="{parent}">'
            f'<mxGeometry x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" as="geometry"/></mxCell>'
        )

    def child(self, cid, style, parent, x, y, w, h, value="", relative=False, offset=None):
        """Adds a vertex inside another cell, optionally with relative geometry."""
        rel = ' relative="1"' if relative else ""
        inner = f'<mxPoint x="{offset[0]:g}" y="{offset[1]:g}" as="offset"/>' if offset else ""
        self.cells.append(
            f'<mxCell id="{cid}" value={quoteattr(value)} style={quoteattr(style)} vertex="1" connectable="0" parent="{parent}">'
            f'<mxGeometry x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}"{rel} as="geometry">{inner}</mxGeometry></mxCell>'
        )

    def edge(self, cid, style, source=None, target=None, source_point=None, target_point=None, points=(),
             value="", label=(0, 0), label_offset=None, parent="1"):
        attrs = f'id="{cid}" value={quoteattr(value)} style={quoteattr(style)} edge="1" parent="{parent}"'
        if source:
            attrs += f' source="{source}"'
        if target:
            attrs += f' target="{target}"'
        inner = ""
        if source_point:
            inner += f'<mxPoint x="{source_point[0]:g}" y="{source_point[1]:g}" as="sourcePoint"/>'
        if target_point:
            inner += f'<mxPoint x="{target_point[0]:g}" y="{target_point[1]:g}" as="targetPoint"/>'
        if points:
            inner += '<Array as="points">' + "".join(f'<mxPoint x="{x:g}" y="{y:g}"/>' for x, y in points) + "</Array>"
        if label_offset:
            inner += f'<mxPoint x="{label_offset[0]:g}" y="{label_offset[1]:g}" as="offset"/>'
        geo = f'x="{label[0]:g}" y="{label[1]:g}" ' if label != (0, 0) else ""
        self.cells.append(f'<mxCell {attrs}><mxGeometry {geo}relative="1" as="geometry">{inner}</mxGeometry></mxCell>')

    def xml(self, index):
        root = '<mxCell id="0"/><mxCell id="1" parent="0"/>' + "".join(self.cells)
        return (
            f'<diagram id="p{index}" name={quoteattr(self.name)}><mxGraphModel grid="1" gridSize="10" '
            f'page="0"><root>{root}</root></mxGraphModel></diagram>'
        )


def write(name, pages):
    body = "".join(p.xml(i + 1) for i, p in enumerate(pages))
    (OUT / f"{name}.drawio").write_text(f'<mxfile host="setsquare-oracle">{body}</mxfile>\n')


TEXT = "whiteSpace=wrap;html=1;"
SHAPES = [
    ("rect", "rounded=0;" + TEXT, 120, 80),
    ("rounded", "rounded=1;" + TEXT, 120, 80),
    ("ellipse", "ellipse;" + TEXT, 120, 80),
    ("circle", "ellipse;aspect=fixed;" + TEXT, 80, 80),
    ("rhombus", "rhombus;" + TEXT, 120, 80),
    ("triangle", "triangle;" + TEXT, 80, 100),
    ("triangle-north", "triangle;direction=north;" + TEXT, 100, 80),
    ("triangle-west", "triangle;direction=west;" + TEXT, 80, 100),
    ("triangle-south", "triangle;direction=south;" + TEXT, 100, 80),
    ("triangle-flipped", "triangle;flipH=1;" + TEXT, 80, 100),
    ("hexagon", "shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;" + TEXT, 120, 80),
    ("hexagon-south", "shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;direction=south;" + TEXT, 80, 120),
    ("hexagon-legacy", "shape=hexagon;perimeter=hexagonPerimeter;" + TEXT, 120, 80),
    ("parallelogram", "shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;" + TEXT, 120, 60),
    ("parallelogram-relative", "shape=parallelogram;perimeter=parallelogramPerimeter;" + TEXT, 120, 60),
    ("trapezoid", "shape=trapezoid;perimeter=trapezoidPerimeter;fixedSize=1;" + TEXT, 120, 60),
    ("step", "shape=step;perimeter=stepPerimeter;fixedSize=1;" + TEXT, 120, 80),
    ("callout", "shape=callout;perimeter=calloutPerimeter;" + TEXT, 120, 80),
    ("cylinder", "shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=15;" + TEXT, 60, 80),
    ("cloud", "ellipse;shape=cloud;" + TEXT, 120, 80),
    ("actor", "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;", 30, 60),
    ("center", "perimeter=centerPerimeter;" + TEXT, 80, 80),
    ("rotated", "rounded=0;rotation=30;" + TEXT, 120, 60),
    ("spaced", "rounded=0;perimeterSpacing=8;" + TEXT, 120, 80),
    ("lifeline", "shape=umlLifeline;perimeter=lifelinePerimeter;container=1;collapsible=0;recursiveResize=0;outlineConnect=0;" + TEXT, 100, 200),
    ("backbone", "line;strokeWidth=4;html=1;perimeter=backbonePerimeter;points=[];outlineConnect=0;", 160, 10),
    ("activation", "html=1;points=[];perimeter=orthogonalPerimeter;outlineConnect=0;", 10, 80),
]


def perimeters():
    page = Page("Perimeters")
    cols, cell_w, cell_h, radius = 5, 440, 440, 170
    for i, (name, style, w, h) in enumerate(SHAPES):
        cx, cy = 220 + (i % cols) * cell_w, 220 + (i // cols) * cell_h
        page.vertex(name, style, cx - w / 2, cy - h / 2, w, h)
        for deg in range(0, 360, 30):
            a = math.radians(deg)
            p = (round(cx + radius * math.cos(a)), round(cy + radius * math.sin(a)))
            page.edge(f"{name}-in{deg}", "endArrow=classic;html=1;", target=name, source_point=p)
        for deg in (15, 105, 195, 285):
            a = math.radians(deg)
            p = (round(cx + radius * math.cos(a)), round(cy + radius * math.sin(a)))
            page.edge(f"{name}-orth{deg}", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;", source=name, target_point=p)
        page.edge(f"{name}-gap", "endArrow=classic;html=1;targetPerimeterSpacing=10;", target=name, source_point=(cx - radius, cy - 40))
    return page


STYLES = [
    ("straight", "endArrow=classic;html=1;"),
    ("orth", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;"),
    ("orth-rounded", "edgeStyle=orthogonalEdgeStyle;html=1;"),
    ("orth-curved", "edgeStyle=orthogonalEdgeStyle;curved=1;html=1;"),
    ("elbow", "edgeStyle=elbowEdgeStyle;rounded=0;html=1;"),
    ("elbow-vertical", "edgeStyle=elbowEdgeStyle;elbow=vertical;rounded=0;html=1;"),
    ("er", "edgeStyle=entityRelationEdgeStyle;rounded=0;html=1;"),
    ("segment", "edgeStyle=segmentEdgeStyle;rounded=0;html=1;"),
    ("side", "edgeStyle=sideToSideEdgeStyle;rounded=0;html=1;"),
    ("top", "edgeStyle=topToBottomEdgeStyle;rounded=0;html=1;"),
    ("iso", "edgeStyle=isometricEdgeStyle;rounded=0;html=1;"),
    ("iso-vertical", "edgeStyle=isometricEdgeStyle;elbow=vertical;rounded=0;html=1;"),
]
OFFSETS = [(260, 0), (260, 130), (260, -130), (0, 210), (-220, 210), (-260, 0), (60, 150), (150, 30), (250, 250)]


def styles():
    page = Page("Styles")
    cell = 560
    for row, (sname, style) in enumerate(STYLES):
        for col, (dx, dy) in enumerate(OFFSETS):
            ox, oy = 300 + col * cell, 300 + row * cell
            s, t = f"{sname}-{col}-s", f"{sname}-{col}-t"
            page.vertex(s, "rounded=0;" + TEXT, ox, oy, 100, 60)
            page.vertex(t, "rounded=0;" + TEXT, ox + dx, oy + dy, 100, 60)
            page.edge(f"{sname}-{col}", style, source=s, target=t)
        ox, oy = 300 + len(OFFSETS) * cell, 300 + row * cell
        s, t = f"{sname}-wp-s", f"{sname}-wp-t"
        page.vertex(s, "rounded=0;" + TEXT, ox, oy, 100, 60)
        page.vertex(t, "rounded=0;" + TEXT, ox + 260, oy + 200, 100, 60)
        page.edge(f"{sname}-wp1", style, source=s, target=t, points=[(ox + 180, oy + 120)])
        page.edge(f"{sname}-wp2", style, source=s, target=t, points=[(ox + 60, oy + 150), (ox + 330, oy + 110)])
        page.vertex(f"{sname}-loop", "rounded=0;" + TEXT, ox + 700, oy, 100, 60)
        page.edge(f"{sname}-loop-e", style, source=f"{sname}-loop", target=f"{sname}-loop")
    return page


def constraints():
    page = Page("Constraints")
    exits = [(1, 0.5), (0.5, 0), (0, 0.5), (0.5, 1), (1, 0), (0, 1), (0.25, 0), (1, 0.75)]
    entries = [(0, 0.5), (0.5, 1), (1, 0.5), (0.5, 0)]
    shapes = [("rect", "rounded=0;" + TEXT), ("ellipse", "ellipse;" + TEXT), ("rhombus", "rhombus;" + TEXT)]
    row = 0
    for sname, sstyle in shapes:
        for orth in (False, True):
            base = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" if orth else "endArrow=classic;html=1;"
            for i, (ex, ey) in enumerate(exits):
                en = entries[i % len(entries)]
                ox, oy = 200 + i * 420, 200 + row * 360
                s, t = f"c-{sname}-{int(orth)}-{i}-s", f"c-{sname}-{int(orth)}-{i}-t"
                page.vertex(s, sstyle, ox, oy, 120, 80)
                page.vertex(t, sstyle, ox + 200 - (i % 3) * 120, oy + 180 - (i % 2) * 300, 120, 80)
                style = base + f"exitX={ex};exitY={ey};entryX={en[0]};entryY={en[1]};"
                page.edge(f"c-{sname}-{int(orth)}-{i}", style, source=s, target=t)
            row += 1
    ox, oy = 200, 200 + row * 360
    page.vertex("ell-a", "ellipse;" + TEXT, ox, oy, 120, 80)
    page.vertex("ell-b", "ellipse;" + TEXT, ox + 300, oy + 100, 120, 80)
    page.edge("perimeter-off", "endArrow=classic;html=1;exitX=1;exitY=0;exitPerimeter=0;entryX=0;entryY=1;entryPerimeter=0;", source="ell-a", target="ell-b")
    page.edge("perimeter-on", "endArrow=classic;html=1;exitX=1;exitY=0;entryX=0;entryY=1;", source="ell-a", target="ell-b")
    page.edge("offsets", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=-20;entryX=0;entryY=0.5;entryDx=0;entryDy=15;", source="ell-a", target="ell-b")
    page.vertex("rot-a", "rounded=0;rotation=45;" + TEXT, ox + 700, oy, 120, 60)
    page.vertex("rot-b", "rounded=0;" + TEXT, ox + 1000, oy + 160, 120, 60)
    page.edge("rotated-exit", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;", source="rot-a", target="rot-b")
    page.edge("rotated-float", "endArrow=classic;html=1;", source="rot-a", target="rot-b")
    page.vertex("flip-a", "triangle;flipH=1;" + TEXT, ox + 1400, oy, 80, 100)
    page.edge("flipped-exit", "endArrow=classic;html=1;exitX=1;exitY=0.5;", source="flip-a", target="rot-b")
    page.vertex("port-host", "rounded=0;" + TEXT, ox + 1700, oy, 160, 100)
    page.vertex("port", "ellipse;" + TEXT, 140, 40, 20, 20, parent="port-host")
    page.edge("to-port", "endArrow=classic;html=1;", source="rot-b", target="port")
    page.edge("source-port-style", "endArrow=classic;html=1;sourcePort=port;", source="port-host", target="rot-b")
    return page


MARKERS = [
    "classic", "classicThin", "block", "blockThin", "open", "openThin", "oval", "baseDash", "doubleBlock",
    "diamond", "diamondThin", "manyOptional", "dash", "box", "cross", "circle", "circlePlus", "halfCircle",
    "async", "openAsync", "ERone", "ERmandOne", "ERmany", "ERoneToMany", "ERzeroToMany", "ERzeroToOne",
]


def markers():
    page = Page("Markers")
    for i, m in enumerate(MARKERS):
        y = 40 + i * 40
        page.edge(f"m-{m}", f"endArrow={m};html=1;", source_point=(40, y), target_point=(240, y))
        page.edge(f"m-{m}-open", f"endArrow={m};endFill=0;html=1;", source_point=(300, y), target_point=(500, y))
        page.edge(f"m-{m}-big", f"endArrow={m};endSize=14;strokeWidth=3;html=1;", source_point=(560, y), target_point=(760, y))
        page.edge(f"m-{m}-start", f"startArrow={m};endArrow=none;startFill=1;html=1;", source_point=(820, y + 10), target_point=(1000, y - 10))
    y = 40 + len(MARKERS) * 40 + 40
    lines = [
        ("rounded", "rounded=1;endArrow=classic;html=1;"),
        ("rounded-arc", "rounded=1;arcSize=40;endArrow=classic;html=1;"),
        ("sharp", "rounded=0;endArrow=classic;html=1;"),
        ("curved", "curved=1;endArrow=classic;html=1;"),
        ("dashed", "dashed=1;rounded=0;endArrow=classic;html=1;"),
        ("dash-pattern", "dashed=1;dashPattern=8 8;rounded=0;endArrow=classic;html=1;"),
        ("dots", "dashed=1;dashPattern=1 4;strokeWidth=2;rounded=0;endArrow=classic;html=1;"),
        ("both-ends", "startArrow=oval;startFill=0;endArrow=diamond;endFill=1;rounded=1;html=1;"),
    ]
    for i, (name, style) in enumerate(lines):
        x = 40 + i * 260
        page.edge(f"l-{name}", style, source_point=(x, y), target_point=(x + 200, y + 160), points=[(x + 40, y + 120), (x + 160, y + 20)])
    return page


def labels():
    page = Page("Labels")
    positions = [(-1, 0), (-0.5, 0), (0, 0), (0.5, 0), (1, 0), (0, 15), (0, -20), (-0.6, 12)]
    for row, style in enumerate(["endArrow=classic;html=1;", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;"]):
        for col, (x, y) in enumerate(positions):
            ox, oy = 100 + col * 320, 100 + row * 320
            s, t = f"lab-{row}-{col}-s", f"lab-{row}-{col}-t"
            page.vertex(s, "rounded=0;" + TEXT, ox, oy, 80, 40)
            page.vertex(t, "rounded=0;" + TEXT, ox + 180, oy + 140, 80, 40)
            offset = (6, -4) if col % 3 == 2 else None
            page.edge(f"lab-{row}-{col}", style, source=s, target=t, value="label", label=(x, y), label_offset=offset)
    oy = 760
    page.vertex("el-s", "rounded=0;" + TEXT, 100, oy, 80, 40)
    page.vertex("el-t", "rounded=0;" + TEXT, 500, oy + 160, 80, 40)
    page.edge("el", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;", source="el-s", target="el-t")
    for i, (x, y, off) in enumerate([(-0.4, 12, (5, -3)), (0.2, 0, None), (0.8, -15, (0, 8))]):
        page.child(f"el-label-{i}", "edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];", "el",
                   x, y, 0, 0, value=f"part {i}", relative=True, offset=off)
    page.child("el-sized", "ellipse;" + TEXT, "el", -0.1, 0, 20, 20, relative=True, offset=(-10, -10))
    page.child("el-absolute", "rounded=0;" + TEXT, "el", 30, 40, 50, 30)
    page.vertex("host", "rounded=0;" + TEXT, 800, oy, 160, 100)
    page.child("port-e", "ellipse;" + TEXT, "host", 1, 0.5, 20, 20, relative=True, offset=(-10, -10))
    page.child("port-n", "ellipse;" + TEXT, "host", 0.25, 0, 16, 16, relative=True, offset=(-8, -8))
    page.child("port-plain", "ellipse;" + TEXT, "host", 0, 1, 12, 12, relative=True)
    page.vertex("port-target", "rounded=0;" + TEXT, 1100, oy + 200, 100, 60)
    page.edge("to-port-e", "endArrow=classic;html=1;", source="port-e", target="port-target")
    page.edge("to-port-n", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;", source="port-n", target="port-target")
    page.vertex("outer", "swimlane;startSize=30;html=1;", 100, 1100, 500, 360, value="Outer")
    page.child("inner", "swimlane;startSize=24;html=1;", "outer", 40, 60, 260, 200, value="Inner")
    page.child("deep", "rounded=0;" + TEXT, "inner", 30, 60, 100, 50, value="Deep")
    page.child("shallow", "rounded=0;" + TEXT, "outer", 360, 260, 100, 50, value="Shallow")
    page.edge("nested", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;", source="deep", target="shallow", value="nested")
    page.edge("inside", "endArrow=classic;html=1;", source="deep", target="shallow", parent="outer", value="inside")
    return page


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write("perimeters", [perimeters()])
    write("styles", [styles()])
    write("constraints", [constraints()])
    write("markers", [markers()])
    write("labels", [labels()])
    print(f"wrote 5 drawings to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
