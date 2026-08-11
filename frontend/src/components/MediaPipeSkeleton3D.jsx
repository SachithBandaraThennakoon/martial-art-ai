import { Line } from "@react-three/drei";
import { memo, useMemo } from "react";
import { buildMediaPipePoseGraph } from "../skeleton/mediaPipePoseGraph";

const WHITE = "#ffffff";

const MediaPipeSkeleton3D = memo(function MediaPipeSkeleton3D({
  graph: suppliedGraph,
  landmarks,
  jointRadius = 0.025,
  lineWidth = 1.45,
  onSelect,
  selectedId = null,
}) {
  const graph = useMemo(
    () => suppliedGraph || buildMediaPipePoseGraph(landmarks),
    [landmarks, suppliedGraph],
  );
  const nodes = [...graph.nodes.values()];

  return (
    <group userData={{ skeletonType: "mediapipe-pose-33" }}>
      {graph.edges.map(({ from, to }) => (
        <Line
          color={WHITE}
          key={`${from}-${to}`}
          lineWidth={lineWidth}
          opacity={0.92}
          points={[graph.nodes.get(from).position, graph.nodes.get(to).position]}
          transparent
        />
      ))}
      {nodes.map((node) => (
        <mesh
          key={node.id}
          onClick={onSelect ? (event) => {
            event.stopPropagation();
            onSelect(node.id, node);
          } : undefined}
          position={node.position}
          scale={selectedId === node.id ? 1.35 : 1}
          userData={{
            landmarkId: node.id,
            landmarkName: node.name,
            landmarkSource: node.source,
          }}
        >
          <sphereGeometry args={[node.virtual ? jointRadius * 0.72 : jointRadius, 12, 10]} />
          <meshBasicMaterial color={WHITE} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
});

export default MediaPipeSkeleton3D;
