import type { CommandCategory } from '../api';

interface Props {
  commands: CommandCategory[];
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function CommandList({ commands, onSelect, onClose }: Props) {
  return (
    <div className="command-overlay" onClick={onClose}>
      <div className="command-panel" onClick={(e) => e.stopPropagation()}>
        <div className="command-header">
          <h3>Команды</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="command-list">
          {commands.map((cat) => (
            <div key={cat.category} className="command-category">
              <div className="category-title">{cat.category}</div>
              {cat.commands.map((cmd) => (
                <button
                  key={cmd.command}
                  className="command-item"
                  onClick={() => onSelect(cmd.command)}
                >
                  <span className="command-text">{cmd.command}</span>
                  <span className="command-desc">{cmd.description}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
